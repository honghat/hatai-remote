from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class CodeFileCreate(BaseModel):
    name: str
    path: str
    language: Optional[str] = None
    content: Optional[str] = None


class CodeFileUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    language: Optional[str] = None
    is_pinned: Optional[bool] = None


class CodeFileOut(BaseModel):
    id: int
    user_id: int
    name: str
    path: str
    language: Optional[str]
    content: Optional[str]
    is_pinned: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ExecuteCommand(BaseModel):
    command: str
    cwd: Optional[str] = None
    timeout: Optional[int] = 30  # seconds


class CommandLogOut(BaseModel):
    id: int
    user_id: int
    command: str
    cwd: Optional[str]
    stdout: Optional[str]
    stderr: Optional[str]
    exit_code: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class ReadFileRequest(BaseModel):
    path: str


class WriteFileRequest(BaseModel):
    path: str
    content: str
    change_summary: Optional[str] = None


class ListDirRequest(BaseModel):
    path: str


class CodeReviewRequest(BaseModel):
    path: str
    content: Optional[str] = None
    instruction: Optional[str] = None
    current_code: Optional[str] = None


class CodeHistoryOut(BaseModel):
    id: int
    user_id: int
    path: str
    content: str
    change_summary: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True
