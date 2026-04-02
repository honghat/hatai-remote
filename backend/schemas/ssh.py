from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class SSHConnectionBase(BaseModel):
    name: str
    host: str
    port: int = 22
    username: str
    auth_method: str = "password"
    default_directory: Optional[str] = None


class SSHConnectionCreate(SSHConnectionBase):
    password: Optional[str] = None
    private_key: Optional[str] = None


class SSHConnectionUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    auth_method: Optional[str] = None
    password: Optional[str] = None
    private_key: Optional[str] = None


class SSHConnectionResponse(SSHConnectionBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── Saved Commands ────────────────────────────────────────────────────────────

class SSHCommandBase(BaseModel):
    name: str
    command: str
    description: Optional[str] = None
    category: Optional[str] = "general"
    icon: Optional[str] = None
    is_favorite: Optional[bool] = False
    connection_id: Optional[int] = None


class SSHCommandCreate(SSHCommandBase):
    pass


class SSHCommandResponse(SSHCommandBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True
