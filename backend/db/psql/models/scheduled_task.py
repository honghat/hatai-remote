from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Boolean
import datetime
from db.psql.session import Base


class ScheduledTask(Base):
    """Recurring AI tasks that run on a cron schedule."""
    __tablename__ = "scheduled_tasks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    prompt = Column(Text, nullable=False)
    cron_expression = Column(String(100), nullable=False)  # "*/30 * * * *"
    is_enabled = Column(Boolean, default=True, nullable=False)
    max_tokens = Column(Integer, default=2048)
    temperature = Column(Integer, default=5)  # stored as int * 10 (0.5 -> 5)

    # Execution tracking
    next_run_at = Column(DateTime, nullable=True)
    last_run_at = Column(DateTime, nullable=True)
    last_status = Column(String(30), nullable=True)  # done | error | cancelled
    last_result = Column(Text, nullable=True)
    run_count = Column(Integer, default=0)

    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))
    updated_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC),
                        onupdate=lambda: datetime.datetime.now(datetime.UTC))
