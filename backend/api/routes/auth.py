from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import timedelta
from schemas.user import LoginRequest, LoginResponse, UserCreate, UserOut
from crud.user_service import UserService
from core.security import create_access_token, get_current_user
from db.psql.session import get_db

router = APIRouter()


@router.post("/login", tags=["Auth"])
async def login(data: LoginRequest, db: Session = Depends(get_db)):
    svc = UserService(db)
    user = svc.authenticate_user(data.username, data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Sai tên đăng nhập hoặc mật khẩu")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Tài khoản đã bị khóa")

    token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(days=30),
    )
    
    # Log activity
    try:
        from crud.user_activity_service import UserActivityService
        UserActivityService(db).log_activity(
            user_id=user.id,
            username=user.username,
            action="Đăng nhập",
            method="POST",
            path="/auth/login",
            details=f"User {user.username} (ID: {user.id}) đã đăng nhập vào hệ thống."
        )
    except Exception:
        pass

    # Build permissions
    permissions = []
    role_info = None
    if user.role:
        role_info = {
            "id": user.role.id,
            "name": user.role.name,
            "display_name": user.role.display_name,
        }
        permissions = [
            {"resource": p.resource, "action": p.action}
            for p in user.role.permissions
        ]

    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "avatar_url": user.avatar_url,
            "role_id": user.role_id,
            "is_active": user.is_active,
            "created_at": str(user.created_at) if user.created_at else None,
            "role": role_info,
            "permissions": permissions,
        },
        "access_token": token,
        "token_type": "bearer",
    }


@router.post("/register", response_model=UserOut, tags=["Auth"])
async def register(data: UserCreate, db: Session = Depends(get_db)):
    svc = UserService(db)
    if svc.get_user_by_username(data.username):
        raise HTTPException(status_code=400, detail="Username đã tồn tại")
    user = svc.create_user(data)
    return user


@router.get("/me", tags=["Auth"])
async def me(user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    svc = UserService(db)
    user = svc.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User không tìm thấy")

    # Build permissions list from role
    permissions = []
    role_info = None
    if user.role:
        role_info = {
            "id": user.role.id,
            "name": user.role.name,
            "display_name": user.role.display_name,
        }
        permissions = [
            {"resource": p.resource, "action": p.action}
            for p in user.role.permissions
        ]

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "avatar_url": user.avatar_url,
        "role_id": user.role_id,
        "is_active": user.is_active,
        "created_at": user.created_at,
        "role": role_info,
        "permissions": permissions,
    }

@router.put("/profile", tags=["Auth"])
async def update_profile(
    data: dict, 
    user_id: int = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    svc = UserService(db)
    user = svc.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Restrict keys that can be updated via this endpoint
    allowed_keys = {"email", "full_name", "password", "avatar_url"}
    update_data = {k: v for k, v in data.items() if k in allowed_keys}
    
    updated_user = svc.update_user(user, update_data)
    return {"message": "Profile updated", "user": {"id": updated_user.id, "full_name": updated_user.full_name, "avatar_url": updated_user.avatar_url}}

from fastapi import UploadFile, File
import os
import shutil
import uuid

@router.post("/avatar", tags=["Auth"])
async def upload_avatar(
    file: UploadFile = File(...), 
    user_id: int = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    svc = UserService(db)
    user = svc.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Create uploads/avatars directory
    avatar_dir = os.path.join("uploads", "avatars")
    os.makedirs(avatar_dir, exist_ok=True)

    # Generate unique filename
    ext = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(avatar_dir, filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    avatar_url = f"/uploads/avatars/{filename}"
    svc.update_user(user, {"avatar_url": avatar_url})

    return {"message": "Avatar uploaded", "avatar_url": avatar_url}
