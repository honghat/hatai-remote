from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# ── Permission ────────────────────────────────────

class PermissionOut(BaseModel):
    id: int
    resource: str
    action: str
    display_name: str
    description: Optional[str] = None

    class Config:
        from_attributes = True


# ── Role ──────────────────────────────────────────

class RoleCreate(BaseModel):
    name: str
    display_name: str
    description: Optional[str] = None
    permission_ids: list[int] = []


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    display_name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    permission_ids: Optional[list[int]] = None


class RoleOut(BaseModel):
    id: int
    name: str
    display_name: str
    description: Optional[str] = None
    is_system: bool
    is_active: bool
    permissions: list[PermissionOut] = []
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── User Admin ────────────────────────────────────

class AdminUserCreate(BaseModel):
    username: str
    password: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    role_id: Optional[int] = None
    is_active: bool = True


class AdminUserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    role_id: Optional[int] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class AdminUserOut(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    role_id: Optional[int] = None
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    role: Optional[RoleOut] = None

    class Config:
        from_attributes = True
