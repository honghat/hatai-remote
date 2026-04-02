from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Boolean
import datetime
from db.psql.session import Base


class SSHCommand(Base):
    """Saved SSH command snippets for quick execution."""
    __tablename__ = "ssh_saved_commands"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    connection_id = Column(Integer, ForeignKey("ssh_connections.id"), nullable=True) # Optional link
    
    name = Column(String(200), nullable=False)
    command = Column(Text, nullable=False)
    description = Column(String(500), nullable=True)
    category = Column(String(100), default="general")
    icon = Column(String(50), nullable=True)
    is_favorite = Column(Boolean, default=False)

    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))
    updated_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC),
                        onupdate=lambda: datetime.datetime.now(datetime.UTC))
