from sqlalchemy.orm import Session
from sqlalchemy import desc
from db.psql.models.user_activity import UserActivity
from typing import List, Optional

class UserActivityService:
    def __init__(self, db: Session):
        self.db = db

    def log_activity(self, 
                    user_id: Optional[int], 
                    username: Optional[str], 
                    action: str, 
                    method: Optional[str] = None, 
                    path: Optional[str] = None, 
                    resource_id: Optional[str] = None, 
                    details: Optional[str] = None,
                    ip_address: Optional[str] = None):
        """Create a new activity log entry."""
        activity = UserActivity(
            user_id=user_id,
            username=username,
            action=action,
            method=method,
            path=path,
            resource_id=resource_id,
            details=details,
            ip_address=ip_address
        )
        self.db.add(activity)
        try:
            self.db.commit()
            self.db.refresh(activity)
        except Exception:
            self.db.rollback()
        return activity

    def get_activities(self, skip: int = 0, limit: int = 100, user_id: Optional[int] = None) -> List[UserActivity]:
        """Fetch historical user logs, latest first."""
        query = self.db.query(UserActivity)
        if user_id:
            query = query.filter(UserActivity.user_id == user_id)
        return query.order_by(desc(UserActivity.timestamp)).offset(skip).limit(limit).all()

    def delete_logs(self, before_days: int = 30):
        """Cleanup old logs."""
        import datetime
        cutoff = datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=before_days)
        self.db.query(UserActivity).filter(UserActivity.timestamp < cutoff).delete()
        self.db.commit()
