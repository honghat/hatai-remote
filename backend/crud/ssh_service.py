from sqlalchemy.orm import Session
from db.psql.models.ssh_connection import SSHConnection
from db.psql.models.ssh_command import SSHCommand
from typing import List, Optional


class SSHService:
    def __init__(self, db: Session):
        self.db = db

    # ── Connections ───────────────────────────────────────────────────────────
    def get_connections(self, user_id: int) -> List[SSHConnection]:
        return self.db.query(SSHConnection).filter(SSHConnection.user_id == user_id).all()

    def get_connection(self, connection_id: int, user_id: int) -> Optional[SSHConnection]:
        return self.db.query(SSHConnection).filter(SSHConnection.id == connection_id, SSHConnection.user_id == user_id).first()

    def create_connection(self, user_id: int, data: dict) -> SSHConnection:
        conn = SSHConnection(user_id=user_id, **data)
        self.db.add(conn)
        self.db.commit()
        self.db.refresh(conn)
        return conn

    # ── Commands ──────────────────────────────────────────────────────────────
    def get_saved_commands(self, user_id: int) -> List[SSHCommand]:
        return self.db.query(SSHCommand).filter(SSHCommand.user_id == user_id).order_by(SSHCommand.is_favorite.desc(), SSHCommand.name).all()

    def create_command(self, user_id: int, data: dict) -> SSHCommand:
        cmd = SSHCommand(user_id=user_id, **data)
        self.db.add(cmd)
        self.db.commit()
        self.db.refresh(cmd)
        return cmd

    def update_command(self, command_id: int, user_id: int, data: dict) -> Optional[SSHCommand]:
        cmd = self.db.query(SSHCommand).filter(SSHCommand.id == command_id, SSHCommand.user_id == user_id).first()
        if not cmd:
            return None
        for k, v in data.items():
            setattr(cmd, k, v)
        self.db.commit()
        self.db.refresh(cmd)
        return cmd

    def delete_command(self, command_id: int, user_id: int) -> bool:
        cmd = self.db.query(SSHCommand).filter(SSHCommand.id == command_id, SSHCommand.user_id == user_id).first()
        if not cmd:
            return False
        self.db.delete(cmd)
        self.db.commit()
        return True
