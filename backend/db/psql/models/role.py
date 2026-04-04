"""
Role-Based Access Control (RBAC) Models
Hỗ trợ phân quyền theo chức danh: Admin, Manager, Operator, Viewer
và theo module hệ thống con: ERP, Kế toán, Chat, Agent, v.v.
"""
import datetime
from sqlalchemy import Column, Integer, String, Unicode, Boolean, DateTime, ForeignKey, Table, Text
from sqlalchemy.orm import relationship
from db.psql.session import Base


# Many-to-many: Role <-> Permission
role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", Integer, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)


class Role(Base):
    """
    Vai trò / Chức danh trong hệ thống.
    Ví dụ: Admin, Manager ERP, Kế toán trưởng, Operator, Viewer
    """
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)  # e.g. "admin", "erp_manager"
    display_name = Column(Unicode(255), nullable=False)       # e.g. "Quản trị viên", "Quản lý ERP"
    description = Column(Text, nullable=True)
    is_system = Column(Boolean, default=False)  # Roles hệ thống không thể xóa
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.UTC),
        onupdate=lambda: datetime.datetime.now(datetime.UTC),
    )

    permissions = relationship("Permission", secondary=role_permissions, back_populates="roles", lazy="joined")

    def __repr__(self):
        return f"<Role(name={self.name})>"


class Permission(Base):
    """
    Quyền hạn cụ thể trong hệ thống.
    Phân theo module (resource) và hành động (action).

    Ví dụ:
      - resource="users", action="manage"  → Quản lý người dùng
      - resource="erp", action="read"      → Xem dữ liệu ERP
      - resource="accounting", action="write" → Nhập liệu kế toán
      - resource="agent", action="execute" → Chạy AI Agent
    """
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)
    resource = Column(String(100), nullable=False)    # Module: users, chat, agent, erp, accounting, ...
    action = Column(String(50), nullable=False)       # Action: read, write, manage, execute, delete
    display_name = Column(Unicode(255), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.UTC))

    roles = relationship("Role", secondary=role_permissions, back_populates="permissions")

    def __repr__(self):
        return f"<Permission({self.resource}:{self.action})>"

    @property
    def code(self) -> str:
        return f"{self.resource}:{self.action}"
