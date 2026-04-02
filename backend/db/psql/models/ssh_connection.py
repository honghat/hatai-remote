from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Boolean
import datetime
from db.psql.session import Base


class SSHConnection(Base):
    """Saved SSH connection profiles for web terminal."""
    __tablename__ = "ssh_connections"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    host = Column(String(255), nullable=False)
    port = Column(Integer, default=22)
    username = Column(String(100), nullable=False)
    auth_method = Column(String(20), default="password")  # password | key
    password_encrypted = Column(Text, nullable=True)
    private_key = Column(Text, nullable=True)
    default_directory = Column(String(500), nullable=True)

    last_connected_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))
    updated_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC),
                        onupdate=lambda: datetime.datetime.now(datetime.UTC))
