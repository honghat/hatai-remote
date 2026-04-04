from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class AITaskCreate(BaseModel):
    prompt: str
    session_id: Optional[int] = None
    temperature: Optional[float] = 0.5
    max_tokens: Optional[int] = 2048
    attachments: Optional[List[Dict[str, Any]]] = None


class AITaskOut(BaseModel):
    id: int
    user_id: int
    prompt: str
    session_id: Optional[int] = None
    result: Optional[str]
    status: str
    model_name: str
    created_at: datetime
    completed_at: Optional[datetime]
    
    # Dynamic fields from memory when running
    progress: Optional[int] = None

    class Config:
        from_attributes = True


class TaskLogOut(BaseModel):
    index: int
    timestamp: float
    type: str
    content: str
    tool: str
    args: Dict[str, Any]
    result: Any
