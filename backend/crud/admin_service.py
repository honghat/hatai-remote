"""
CRUD service cho quản lý Users, Roles, Permissions (Admin).
"""
from hashlib import sha256
from typing import Optional
from sqlalchemy.orm import Session
from db.psql.models.user import User
from db.psql.models.role import Role, Permission, role_permissions


class AdminService:
    def __init__(self, db: Session):
        self.db = db

    # ── Users ──────────────────────────────────────────────

    def list_users(self, search: Optional[str] = None, role_id: Optional[int] = None, is_active: Optional[bool] = None):
        q = self.db.query(User)
        if search:
            pattern = f"%{search}%"
            q = q.filter(
                (User.username.ilike(pattern)) |
                (User.full_name.ilike(pattern)) |
                (User.email.ilike(pattern))
            )
        if role_id is not None:
            q = q.filter(User.role_id == role_id)
        if is_active is not None:
            q = q.filter(User.is_active == is_active)
        return q.order_by(User.created_at.desc()).all()

    def get_user(self, user_id: int) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def update_user(self, user_id: int, data: dict) -> Optional[User]:
        user = self.get_user(user_id)
        if not user:
            return None
        for key, value in data.items():
            if key == "password" and value:
                value = sha256(value.encode("utf-8")).hexdigest()
            if hasattr(user, key) and value is not None:
                setattr(user, key, value)
        self.db.commit()
        self.db.refresh(user)
        return user

    def create_user(self, data: dict) -> User:
        user = User(
            username=data["username"],
            password=sha256(data["password"].encode("utf-8")).hexdigest(),
            email=data.get("email"),
            full_name=data.get("full_name"),
            role_id=data.get("role_id"),
            is_active=data.get("is_active", True),
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def delete_user(self, user_id: int) -> bool:
        user = self.get_user(user_id)
        if not user:
            return False
        self.db.delete(user)
        self.db.commit()
        return True

    def toggle_user_active(self, user_id: int) -> Optional[User]:
        user = self.get_user(user_id)
        if not user:
            return None
        user.is_active = not user.is_active
        self.db.commit()
        self.db.refresh(user)
        return user

    # ── Roles ──────────────────────────────────────────────

    def list_roles(self):
        return self.db.query(Role).order_by(Role.id).all()

    def get_role(self, role_id: int) -> Optional[Role]:
        return self.db.query(Role).filter(Role.id == role_id).first()

    def get_role_by_name(self, name: str) -> Optional[Role]:
        return self.db.query(Role).filter(Role.name == name).first()

    def create_role(self, data: dict) -> Role:
        role = Role(
            name=data["name"],
            display_name=data["display_name"],
            description=data.get("description"),
            is_system=data.get("is_system", False),
        )
        # Attach permissions
        perm_ids = data.get("permission_ids", [])
        if perm_ids:
            perms = self.db.query(Permission).filter(Permission.id.in_(perm_ids)).all()
            role.permissions = perms
        self.db.add(role)
        self.db.commit()
        self.db.refresh(role)
        return role

    def update_role(self, role_id: int, data: dict) -> Optional[Role]:
        role = self.get_role(role_id)
        if not role:
            return None
        for key in ("name", "display_name", "description", "is_active"):
            if key in data and data[key] is not None:
                setattr(role, key, data[key])
        if "permission_ids" in data:
            perms = self.db.query(Permission).filter(Permission.id.in_(data["permission_ids"])).all()
            role.permissions = perms
        self.db.commit()
        self.db.refresh(role)
        return role

    def delete_role(self, role_id: int) -> bool:
        role = self.get_role(role_id)
        if not role or role.is_system:
            return False
        self.db.delete(role)
        self.db.commit()
        return True

    # ── Permissions ────────────────────────────────────────

    def list_permissions(self):
        return self.db.query(Permission).order_by(Permission.resource, Permission.action).all()

    def get_permission(self, perm_id: int) -> Optional[Permission]:
        return self.db.query(Permission).filter(Permission.id == perm_id).first()

    # ── Seed default roles & permissions ───────────────────

    def seed_defaults(self):
        """Tạo roles & permissions mặc định hoặc đồng bộ font chữ."""
        # Define default permissions per module
        modules = {
            "users": ("Người dùng", ["read", "write", "manage"]),
            "chat": ("Chat AI", ["read", "write", "manage"]),
            "agent": ("AI Agent", ["read", "execute", "manage"]),
            "tasks": ("Tác vụ nền", ["read", "write", "manage"]),
            "schedules": ("Lịch định kỳ", ["read", "write", "manage"]),
            "terminal": ("SSH Terminal", ["read", "execute", "manage"]),
            "code": ("HatAI Code", ["read", "write", "manage"]),
            "skills": ("Kỹ năng Agent", ["read", "write", "manage"]),
            "brain": ("Trí tuệ & Bộ nhớ", ["read", "write", "manage"]),
            "erp": ("ERP", ["read", "write", "manage"]),
            "accounting": ("Kế toán & Tài chính", ["read", "write", "approve", "manage"]),
        }

        action_labels = {
            "read": "Xem",
            "write": "Tạo/Sửa",
            "manage": "Quản lý toàn bộ",
            "execute": "Thực thi",
            "delete": "Xóa",
            "approve": "Phê duyệt",
        }

        all_perms = []
        for resource, (module_label, actions) in modules.items():
            for action in actions:
                disp = f"{action_labels.get(action, action)} {module_label}"
                desc = f"Quyền {action_labels.get(action, action).lower()} module {module_label}"
                
                # Sync existing or create new
                perm = self.db.query(Permission).filter(Permission.resource == resource, Permission.action == action).first()
                if perm:
                    perm.display_name = disp
                    perm.description = desc
                else:
                    perm = Permission(
                        resource=resource,
                        action=action,
                        display_name=disp,
                        description=desc,
                    )
                    self.db.add(perm)
                all_perms.append(perm)

        self.db.flush()
        self.db.commit()

        # roles initialization if not exists
        if self.db.query(Role).count() > 0:
            return # Skip role seeding if already exists

        # Default roles
        admin_role = Role(
            name="admin",
            display_name="Quản trị viên",
            description="Full quyền trên toàn hệ thống",
            is_system=True,
            permissions=all_perms,
        )

        manager_perms = [p for p in all_perms if p.action in ("read", "write", "execute")]
        manager_role = Role(
            name="manager",
            display_name="Quản lý",
            description="Quản lý vận hành, không quản trị hệ thống",
            is_system=True,
            permissions=manager_perms,
        )

        operator_perms = [p for p in all_perms if p.resource in ("chat", "agent", "tasks", "brain") and p.action in ("read", "write", "execute")]
        operator_role = Role(
            name="operator",
            display_name="Nhân viên Vận hành",
            description="Sử dụng AI Agent và các tác vụ cơ bản",
            is_system=True,
            permissions=operator_perms,
        )

        viewer_role = Role(
            name="viewer",
            display_name="Người xem",
            description="Chỉ có quyền xem, không thao tác",
            is_system=True,
            permissions=[p for p in all_perms if p.action == "read"],
        )

        for role in (admin_role, manager_role, operator_role, viewer_role):
            self.db.add(role)

        self.db.commit()

        # Assign admin role to existing admin users (role_id=1)
        admin = self.db.query(Role).filter(Role.name == "admin").first()
        if admin:
            self.db.query(User).filter(User.role_id == 1).update({"role_id": admin.id})
            # Assign operator role to existing normal users (role_id=2)
            operator = self.db.query(Role).filter(Role.name == "operator").first()
            if operator:
                self.db.query(User).filter(User.role_id == 2).update({"role_id": operator.id})
            self.db.commit()

    def seed_ai_providers(self):
        """Seed AI Providers from legacy .env config if DB is empty."""
        from db.psql.models.ai_provider import AIProvider
        from core import config
        import logging
        logger = logging.getLogger("HatAI-Remote")

        if self.db.query(AIProvider).count() > 0:
            return

        providers = []
        
        # 1. Gemini
        if hasattr(config, 'GEMINI_API_KEY') and config.GEMINI_API_KEY:
            providers.append(AIProvider(
                name="Google Gemini (Legacy)",
                provider_type="gemini",
                model_name=getattr(config, 'GEMINI_MODEL', "gemini-2.0-flash-exp"),
                api_key=config.GEMINI_API_KEY,
                is_active=(getattr(config, 'LLM_PROVIDER', '') == "gemini")
            ))

        # 2. Ollama
        if hasattr(config, 'OLLAMA_URL') and config.OLLAMA_URL:
            providers.append(AIProvider(
                name="Ollama Local (Legacy)",
                provider_type="ollama",
                model_name=getattr(config, 'OLLAMA_MODEL', "llama3"),
                api_base=config.OLLAMA_URL,
                is_active=(getattr(config, 'LLM_PROVIDER', '') == "ollama")
            ))

        # 3. OpenAI
        if hasattr(config, 'OPENAI_API_BASE') and config.OPENAI_API_BASE:
            providers.append(AIProvider(
                name="Enterprise / OpenAI (Legacy)",
                provider_type="openai",
                model_name=getattr(config, 'OPENAI_MODEL', "gpt-4o"),
                api_base=config.OPENAI_API_BASE,
                api_key=getattr(config, 'OPENAI_API_KEY', ''),
                is_active=(getattr(config, 'LLM_PROVIDER', '') == "openai")
            ))
            
        # 4. DeepSeek
        if hasattr(config, 'DEEPSEEK_API_KEY') and config.DEEPSEEK_API_KEY:
            providers.append(AIProvider(
                name="DeepSeek Official (Web)",
                provider_type="deepseek",
                model_name=getattr(config, 'DEEPSEEK_MODEL', "deepseek-chat"),
                api_key=config.DEEPSEEK_API_KEY,
                is_active=(getattr(config, 'LLM_PROVIDER', '') == "deepseek")
            ))

        if not providers:
            # Default fallback
            providers.append(AIProvider(
                name="OpenAI Standard",
                provider_type="openai",
                model_name="gpt-4o",
                api_base="https://api.openai.com/v1",
                is_active=True
            ))

        self.db.add_all(providers)
        self.db.commit()
        logger.info(f"✅ Migrated {len(providers)} legacy AI providers to DB.")
