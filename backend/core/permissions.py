"""
Permission middleware cho FastAPI.
Sử dụng:
    @router.get("/admin-only", dependencies=[Depends(require_admin)])
    @router.get("/erp", dependencies=[Depends(require_permission("erp", "read"))])
"""
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session
from core.security import get_current_user
from db.psql.session import get_db
from db.psql.models.user import User


def _get_user_with_role(user_id: int, db: Session) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tài khoản không hợp lệ hoặc đã bị khóa")
    return user


async def require_admin(
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Yêu cầu user có role admin (is_system=True và name='admin')."""
    user = _get_user_with_role(user_id, db)
    if not user.role or user.role.name != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chỉ quản trị viên mới có quyền truy cập")
    return user


def require_permission(resource: str, action: str):
    """
    Factory tạo dependency kiểm tra quyền cụ thể.
    Admin luôn có full quyền.
    """
    async def _check(
        user_id: int = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        user = _get_user_with_role(user_id, db)
        if not user.role:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bạn chưa được gán vai trò")

        # Admin bypass
        if user.role.name == "admin":
            return user

        # Check specific permission
        for perm in user.role.permissions:
            # Exact match or wildcard manage
            if perm.resource == resource and perm.action in (action, "manage"):
                return user

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Bạn không có quyền {action} trên module {resource}",
        )

    return _check


def require_any_permission(*perms: tuple[str, str]):
    """
    Yêu cầu user có ít nhất 1 trong các quyền được liệt kê.
    Ví dụ: require_any_permission(("erp", "read"), ("accounting", "read"))
    """
    async def _check(
        user_id: int = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        user = _get_user_with_role(user_id, db)
        if not user.role:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bạn chưa được gán vai trò")

        if user.role.name == "admin":
            return user

        user_perms = {(p.resource, p.action) for p in user.role.permissions}
        user_manage = {p.resource for p in user.role.permissions if p.action == "manage"}

        for resource, action in perms:
            if (resource, action) in user_perms or resource in user_manage:
                return user

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bạn không có quyền truy cập chức năng này")

    return _check
