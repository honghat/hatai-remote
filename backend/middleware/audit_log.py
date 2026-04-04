import logging
import json
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from jose import jwt, JWTError
from core.config import SECRET_KEY, ALGORITHM
from crud.user_activity_service import UserActivityService
from db.psql.session import SessionLocal

logger = logging.getLogger("HatAI-Remote.Audit")

# Skip health checks, logs themselves, etc.
SKIP_PATHS = ["/docs", "/redoc", "/openapi.json", "/health", "/admin/activities"]

class AuditLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # 1. Process the request
        response = await call_next(request)

        # 2. Log important actions (POST, PUT, DELETE, PATCH, etc.)
        method = request.method
        path = request.url.path

        if method in ["POST", "PUT", "DELETE", "PATCH"]:
            # Check if path should be skipped
            if any(path.startswith(p) for p in SKIP_PATHS):
                return response

            # Try to get user from token
            user_id = None
            username = None
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header.split(" ")[1]
                try:
                    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
                    user_id = payload.get("sub")
                    if user_id:
                        user_id = int(user_id)
                except (JWTError, ValueError):
                    pass

            # If we don't have user_id, maybe it's a login request
            if not user_id and path == "/auth/login":
                # For login, we can't easily read the body here because it's a stream
                # but we can assume it's a login attempt
                pass

            # Create DB session
            db = SessionLocal()
            try:
                # Get username if user_id exists
                if user_id:
                    from db.psql.models.user import User
                    user = db.query(User).filter(User.id == user_id).first()
                    if user:
                        username = user.username

                # Define the action based on path
                action = f"{method} {path}"
                # Mapping actions nicely
                if "/auth/login" in path: action = "Đăng nhập"
                elif "/tasks" in path: action = "Quản lý Tác vụ"
                elif "/chat" in path: action = "Hỗ trợ AI"
                elif "/project" in path: action = "Chỉnh sửa code"
                elif "/admin/users" in path: action = "Quản lý Người dùng"
                elif "/admin/roles" in path: action = "Quản lý Quyền"
                elif "/schedules" in path: action = "Lịch trình"
                elif "/ssh" in path: action = "Kết nối máy chủ"

                details = f"User thực hiện {method} trên {path}"
                ip_address = request.client.host if request.client else "unknown"

                # Log to DB
                svc = UserActivityService(db)
                svc.log_activity(
                    user_id=user_id,
                    username=username,
                    action=action,
                    method=method,
                    path=path,
                    details=details,
                    ip_address=ip_address
                )
            except Exception as e:
                logger.error(f"Failed to log audit entry: {e}")
            finally:
                db.close()

        return response
