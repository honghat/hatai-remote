from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Boolean
import datetime
from db.psql.session import Base


class AITask(Base):
    """AI tasks submitted by users for background agent processing"""
    __tablename__ = "ai_tasks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    prompt = Column(Text, nullable=False)
    session_id = Column(Integer, ForeignKey("chat_sessions.id"), nullable=True)
    result = Column(Text, nullable=True)
    status = Column(String(30), default="pending")  # pending | running | done | error | cancelled
    model_name = Column(String(100), default="agent")
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))
    completed_at = Column(DateTime, nullable=True)
