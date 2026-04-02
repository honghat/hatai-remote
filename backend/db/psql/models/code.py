from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Boolean
import datetime
from db.psql.session import Base


class CodeFile(Base):
    """Tracks files managed remotely"""
    __tablename__ = "code_files"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    path = Column(Text, nullable=False)          # full absolute path
    language = Column(String(50), nullable=True)  # python, js, etc.
    content = Column(Text, nullable=True)
    is_pinned = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )


class CommandLog(Base):
    """Logs executed shell commands"""
    __tablename__ = "command_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    command = Column(Text, nullable=False)
    cwd = Column(Text, nullable=True)
    stdout = Column(Text, nullable=True)
    stderr = Column(Text, nullable=True)
    exit_code = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))


class CodeHistory(Base):
    """Stores versions/backups of files before they are overwritten"""
    __tablename__ = "code_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    path = Column(Text, nullable=False, index=True)
    content = Column(Text, nullable=False)
    change_summary = Column(Text, nullable=True) # e.g. "AI Refactor", "Manual Edit"
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))
