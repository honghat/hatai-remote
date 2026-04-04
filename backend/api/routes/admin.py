"""
Admin API Routes — Quản lý Users, Roles, Permissions
Tất cả endpoints yêu cầu quyền Admin.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from core.permissions import require_admin, require_permission
from crud.admin_service import AdminService
from db.psql.session import get_db
from schemas.admin import (
    AdminUserCreate, AdminUserUpdate, AdminUserOut,
    RoleCreate, RoleUpdate, RoleOut,
    PermissionOut,
)

router = APIRouter()


# ── Users ──────────────────────────────────────────────

@router.get("/users", response_model=list[AdminUserOut], tags=["Admin"])
async def list_users(
    search: Optional[str] = Query(None),
    role_id: Optional[int] = Query(None),
    is_active: Optional[bool] = Query(None),
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    svc = AdminService(db)
    return svc.list_users(search=search, role_id=role_id, is_active=is_active)


@router.get("/users/{user_id}", response_model=AdminUserOut, tags=["Admin"])
async def get_user(user_id: int, admin=Depends(require_admin), db: Session = Depends(get_db)):
    svc = AdminService(db)
    user = svc.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User không tìm thấy")
    return user


@router.post("/users", response_model=AdminUserOut, tags=["Admin"])
async def create_user(data: AdminUserCreate, admin=Depends(require_admin), db: Session = Depends(get_db)):
    svc = AdminService(db)
    from crud.user_service import UserService
    usvc = UserService(db)
    if usvc.get_user_by_username(data.username):
        raise HTTPException(status_code=400, detail="Username đã tồn tại")
    user = svc.create_user(data.model_dump())
    return user


@router.put("/users/{user_id}", response_model=AdminUserOut, tags=["Admin"])
async def update_user(user_id: int, data: AdminUserUpdate, admin=Depends(require_admin), db: Session = Depends(get_db)):
    svc = AdminService(db)
    user = svc.update_user(user_id, data.model_dump(exclude_unset=True))
    if not user:
        raise HTTPException(status_code=404, detail="User không tìm thấy")
    return user


@router.delete("/users/{user_id}", tags=["Admin"])
async def delete_user(user_id: int, admin=Depends(require_admin), db: Session = Depends(get_db)):
    svc = AdminService(db)
    # Prevent self-delete
    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="Không thể xóa chính mình")
    if not svc.delete_user(user_id):
        raise HTTPException(status_code=404, detail="User không tìm thấy")
    return {"ok": True}


@router.post("/users/{user_id}/toggle-active", response_model=AdminUserOut, tags=["Admin"])
async def toggle_user_active(user_id: int, admin=Depends(require_admin), db: Session = Depends(get_db)):
    svc = AdminService(db)
    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="Không thể khóa chính mình")
    user = svc.toggle_user_active(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User không tìm thấy")
    return user


# ── Roles ──────────────────────────────────────────────

@router.get("/roles", response_model=list[RoleOut], tags=["Admin"])
async def list_roles(admin=Depends(require_admin), db: Session = Depends(get_db)):
    svc = AdminService(db)
    return svc.list_roles()


@router.get("/roles/{role_id}", response_model=RoleOut, tags=["Admin"])
async def get_role(role_id: int, admin=Depends(require_admin), db: Session = Depends(get_db)):
    svc = AdminService(db)
    role = svc.get_role(role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role không tìm thấy")
    return role


@router.post("/roles", response_model=RoleOut, tags=["Admin"])
async def create_role(data: RoleCreate, admin=Depends(require_admin), db: Session = Depends(get_db)):
    svc = AdminService(db)
    if svc.get_role_by_name(data.name):
        raise HTTPException(status_code=400, detail="Tên role đã tồn tại")
    role = svc.create_role(data.model_dump())
    return role


@router.put("/roles/{role_id}", response_model=RoleOut, tags=["Admin"])
async def update_role(role_id: int, data: RoleUpdate, admin=Depends(require_admin), db: Session = Depends(get_db)):
    svc = AdminService(db)
    role = svc.update_role(role_id, data.model_dump(exclude_unset=True))
    if not role:
        raise HTTPException(status_code=404, detail="Role không tìm thấy")
    return role


@router.delete("/roles/{role_id}", tags=["Admin"])
async def delete_role(role_id: int, admin=Depends(require_admin), db: Session = Depends(get_db)):
    svc = AdminService(db)
    role = svc.get_role(role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role không tìm thấy")
    if role.is_system:
        raise HTTPException(status_code=400, detail="Không thể xóa role hệ thống")
    svc.delete_role(role_id)
    return {"ok": True}


# ── Permissions ────────────────────────────────────────

@router.get("/permissions", response_model=list[PermissionOut], tags=["Admin"])
async def list_permissions(admin=Depends(require_admin), db: Session = Depends(get_db)):
    svc = AdminService(db)
    return svc.list_permissions()


# ── My Permissions (for any authenticated user) ───────

@router.get("/my-permissions", tags=["Admin"])
async def my_permissions(
    user=Depends(require_permission("users", "read")),
):
    """Trả về danh sách quyền của user hiện tại."""
    return {
        "role": {
            "id": user.role.id,
            "name": user.role.name,
            "display_name": user.role.display_name,
        },
        "permissions": [
            {"resource": p.resource, "action": p.action, "display_name": p.display_name}
            for p in user.role.permissions
        ],
    }


# ── Activity History ───────────────────────────────────

@router.get("/activities", tags=["Admin"])
async def list_activities(
    skip: int = Query(0),
    limit: int = Query(100),
    user_id: Optional[int] = Query(None),
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Lấy danh sách lịch sử hoạt động của hệ thống."""
    from crud.user_activity_service import UserActivityService
    svc = UserActivityService(db)
    return svc.get_activities(skip=skip, limit=limit, user_id=user_id)


# ── Database Fixes ─────────────────────────────────────

    db.commit()
    logger.info("✅ Finished fixing permission fonts.")
    # Endpoint previously here


@router.delete("/activities/clear", tags=["Admin"])
async def clear_activities(admin=Depends(require_admin), db: Session = Depends(get_db)):
    """Xóa toàn bộ lịch sử hoạt động."""
    from db.psql.models.user_activity import UserActivity
    db.query(UserActivity).delete()
    db.commit()
    return {"status": "success", "message": "Đã xóa toàn bộ lịch sử"}
