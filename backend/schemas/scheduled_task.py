from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime


class ScheduledTaskCreate(BaseModel):
    name: str
    prompt: str
    cron_expression: str
    max_tokens: Optional[int] = 2048
    temperature: Optional[float] = 0.5

    @field_validator("cron_expression")
    @classmethod
    def validate_cron(cls, v):
        try:
            from croniter import croniter
            croniter(v)
        except (ValueError, TypeError):
            raise ValueError(f"Invalid cron expression: {v}")
        return v


class ScheduledTaskUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    cron_expression: Optional[str] = None
    is_enabled: Optional[bool] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None

    @field_validator("cron_expression")
    @classmethod
    def validate_cron(cls, v):
        if v is None:
            return v
        try:
            from croniter import croniter
            croniter(v)
        except (ValueError, TypeError):
            raise ValueError(f"Invalid cron expression: {v}")
        return v


class ScheduledTaskOut(BaseModel):
    id: int
    user_id: int
    name: str
    prompt: str
    cron_expression: str
    is_enabled: bool
    max_tokens: int
    temperature: float
    next_run_at: Optional[datetime] = None
    last_run_at: Optional[datetime] = None
    last_status: Optional[str] = None
    last_result: Optional[str] = None
    run_count: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
