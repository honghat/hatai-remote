from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import timedelta
from schemas.user import LoginRequest, LoginResponse, UserCreate, UserOut
from crud.user_service import UserService
from core.security import create_access_token, get_current_user
from db.psql.session import get_db

router = APIRouter()


@router.post("/login", response_model=LoginResponse, tags=["Auth"])
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
    return {
        "user": user,
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


@router.get("/me", response_model=UserOut, tags=["Auth"])
async def me(user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    svc = UserService(db)
    user = svc.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User không tìm thấy")
    return user
