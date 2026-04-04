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
            
        import os, json
        # 1. Identify all attachments in this session to delete files
        messages = self.get_messages(session_id)
        for msg in messages:
            if msg.attachments:
                try:
                    att_list = json.loads(msg.attachments)
                    for att in att_list:
                        if "url" in att:
                            # Resolve path: /uploads/uuid.png -> uploads/uuid.png
                            rel_path = att["url"].lstrip("/")
                            if os.path.exists(rel_path):
                                try:
                                    os.remove(rel_path)
                                except Exception:
                                    pass
                except Exception:
                    pass

        # 2. Delete messages first
        self.db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
        # 3. Delete session
        self.db.delete(session)
        self.db.commit()
        return True

    def add_message(self, session_id: int, role: str, content: str, attachments: Optional[str] = None) -> ChatMessage:
        msg = ChatMessage(session_id=session_id, role=role, content=content, attachments=attachments)
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
