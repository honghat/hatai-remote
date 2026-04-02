from sqlalchemy.orm import Session
from hashlib import sha256
from db.psql.models.user import User
from schemas.user import UserCreate
from typing import Optional


class UserService:
    def __init__(self, db: Session):
        self.db = db

    def _hash(self, password: str) -> str:
        return sha256(password.encode("utf-8")).hexdigest()

    def get_user_by_id(self, user_id: int) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def get_user_by_username(self, username: str) -> Optional[User]:
        return self.db.query(User).filter(User.username == username).first()

    def authenticate_user(self, username: str, password: str) -> Optional[User]:
        user = self.get_user_by_username(username)
        if not user:
            return None
        if not user.check_password(password):
            return None
        return user

    def create_user(self, data: UserCreate) -> User:
        user = User(
            username=data.username,
            password=self._hash(data.password),
            email=data.email,
            full_name=data.full_name,
            role_id=2,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user
