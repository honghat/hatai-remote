from sqlalchemy.orm import Session
from db.psql.models.chat import ChatSession, ChatMessage
from schemas.chat import ChatSessionCreate
from typing import List, Optional
import datetime


class ChatService:
    def __init__(self, db: Session):
        self.db = db

    def create_session(self, user_id: int, data: ChatSessionCreate) -> ChatSession:
        session = ChatSession(
            user_id=user_id,
            title=data.title or "New Chat",
        )
        self.db.add(session)
        self.db.commit()
        self.db.refresh(session)
        return session

    def get_sessions(self, user_id: int) -> List[ChatSession]:
        return (
            self.db.query(ChatSession)
            .filter(ChatSession.user_id == user_id)
            .order_by(ChatSession.updated_at.desc())
            .all()
        )

    def get_session(self, session_id: int, user_id: int) -> Optional[ChatSession]:
        return (
            self.db.query(ChatSession)
            .filter(ChatSession.id == session_id, ChatSession.user_id == user_id)
            .first()
        )

    def delete_session(self, session_id: int, user_id: int) -> bool:
        session = self.get_session(session_id, user_id)
        if not session:
            return False
        # delete messages first
        self.db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
        self.db.delete(session)
        self.db.commit()
        return True

    def add_message(self, session_id: int, role: str, content: str) -> ChatMessage:
        msg = ChatMessage(session_id=session_id, role=role, content=content)
        self.db.add(msg)
        # update session updated_at
        self.db.query(ChatSession).filter(ChatSession.id == session_id).update(
            {"updated_at": datetime.datetime.now(datetime.UTC)}
        )
        self.db.commit()
        self.db.refresh(msg)
        return msg

    def get_messages(self, session_id: int) -> List[ChatMessage]:
        return (
            self.db.query(ChatMessage)
            .filter(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.asc())
            .all()
        )

    def update_session_title(self, session_id: int, title: str):
        self.db.query(ChatSession).filter(ChatSession.id == session_id).update(
            {"title": title}
        )
        self.db.commit()
