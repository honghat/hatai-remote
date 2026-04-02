from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ChatMessageCreate(BaseModel):
    role: str
    content: str


class ChatMessageOut(BaseModel):
    id: int
    session_id: int
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class ChatSessionCreate(BaseModel):
    title: Optional[str] = "New Chat"


class ChatSessionOut(BaseModel):
    id: int
    user_id: int
    title: str
    model_name: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ChatRequest(BaseModel):
    session_id: Optional[int] = None  # None = create new session
    message: str
    system_prompt: Optional[str] = "Bạn là một trợ lý AI thông minh, hữu ích và thân thiện."
    max_tokens: Optional[int] = 8192
    temperature: Optional[float] = 0.7
    stream: Optional[bool] = True
    attachments: Optional[List[dict]] = None
    model: Optional[str] = "default"
