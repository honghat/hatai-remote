from hashlib import sha256
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Unicode, ForeignKey
from sqlalchemy.orm import relationship
import datetime
from db.psql.session import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True, nullable=False)
    password = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=True)
    full_name = Column(Unicode(255), nullable=True)
    role_id = Column(Integer, ForeignKey("roles.id"), default=None, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )

    role = relationship("Role", lazy="joined")

    def __repr__(self):
        return f"<User(username={self.username}, role_id={self.role_id})>"

    def hash_password(self, password: str) -> str:
        return sha256(password.encode("utf-8")).hexdigest()

    def check_password(self, password: str) -> bool:
        return self.password == self.hash_password(password)
