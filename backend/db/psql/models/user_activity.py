from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON, Unicode
from sqlalchemy.orm import relationship
import datetime
from db.psql.session import Base

class UserActivity(Base):
    __tablename__ = "user_activities"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    username = Column(String(100), nullable=True) # Direct copy for fast read and historical record if user deleted
    action = Column(String(100), nullable=False) # e.g. "CREATE_TASK", "DELETE_FILE", "LOGIN"
    method = Column(String(10), nullable=True) # GET, POST, etc
    path = Column(String(255), nullable=True) # /api/v1/tasks
    resource_id = Column(String(100), nullable=True) # The ID of the resource affected
    details = Column(Unicode(1000), nullable=True) # Description or details
    ip_address = Column(String(50), nullable=True)
    timestamp = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))

    user = relationship("User")

    def __repr__(self):
        return f"<UserActivity(user={self.username}, action={self.action}, timestamp={self.timestamp})>"
