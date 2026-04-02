"""
Scheduled Tasks Routes — CRUD + manual trigger for periodic AI tasks
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.schedule_runner import ScheduleRunner
from core.security import get_current_user
from db.psql.session import get_db
from db.psql.models.scheduled_task import ScheduledTask
from schemas.scheduled_task import ScheduledTaskCreate, ScheduledTaskUpdate, ScheduledTaskOut

router = APIRouter()


@router.post("", response_model=ScheduledTaskOut, tags=["Schedules"])
def create_schedule(
    data: ScheduledTaskCreate,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new periodic scheduled task."""
    next_run = ScheduleRunner.compute_next_run(data.cron_expression)

    st = ScheduledTask(
        user_id=user_id,
        name=data.name,
        prompt=data.prompt,
        cron_expression=data.cron_expression,
        is_enabled=True,
        max_tokens=data.max_tokens or 2048,
        temperature=int((data.temperature or 0.5) * 10),
        next_run_at=next_run,
        run_count=0,
    )
    db.add(st)
    db.commit()
    db.refresh(st)

    out = ScheduledTaskOut.from_orm(st)
    out.temperature = (st.temperature or 5) / 10.0
    return out


@router.get("", response_model=List[ScheduledTaskOut], tags=["Schedules"])
def list_schedules(
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all scheduled tasks for the current user."""
    tasks = (
        db.query(ScheduledTask)
        .filter(ScheduledTask.user_id == user_id)
        .order_by(ScheduledTask.created_at.desc())
        .all()
    )
    results = []
    for st in tasks:
        out = ScheduledTaskOut.from_orm(st)
        out.temperature = (st.temperature or 5) / 10.0
        results.append(out)
    return results


@router.get("/{schedule_id}", response_model=ScheduledTaskOut, tags=["Schedules"])
def get_schedule(
    schedule_id: int,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a specific scheduled task."""
    st = db.query(ScheduledTask).filter(
        ScheduledTask.id == schedule_id,
        ScheduledTask.user_id == user_id,
    ).first()
    if not st:
        raise HTTPException(status_code=404, detail="Scheduled task not found")
    out = ScheduledTaskOut.from_orm(st)
    out.temperature = (st.temperature or 5) / 10.0
    return out


@router.put("/{schedule_id}", response_model=ScheduledTaskOut, tags=["Schedules"])
def update_schedule(
    schedule_id: int,
    data: ScheduledTaskUpdate,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a scheduled task (name, prompt, cron, enabled, etc.)."""
    st = db.query(ScheduledTask).filter(
        ScheduledTask.id == schedule_id,
        ScheduledTask.user_id == user_id,
    ).first()
    if not st:
        raise HTTPException(status_code=404, detail="Scheduled task not found")

    if data.name is not None:
        st.name = data.name
    if data.prompt is not None:
        st.prompt = data.prompt
    if data.cron_expression is not None:
        st.cron_expression = data.cron_expression
        st.next_run_at = ScheduleRunner.compute_next_run(data.cron_expression)
    if data.is_enabled is not None:
        st.is_enabled = data.is_enabled
        if data.is_enabled and not st.next_run_at:
            st.next_run_at = ScheduleRunner.compute_next_run(st.cron_expression)
    if data.max_tokens is not None:
        st.max_tokens = data.max_tokens
    if data.temperature is not None:
        st.temperature = int(data.temperature * 10)

    db.commit()
    db.refresh(st)

    out = ScheduledTaskOut.from_orm(st)
    out.temperature = (st.temperature or 5) / 10.0
    return out


@router.delete("/{schedule_id}", tags=["Schedules"])
def delete_schedule(
    schedule_id: int,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a scheduled task."""
    st = db.query(ScheduledTask).filter(
        ScheduledTask.id == schedule_id,
        ScheduledTask.user_id == user_id,
    ).first()
    if not st:
        raise HTTPException(status_code=404, detail="Scheduled task not found")

    db.delete(st)
    db.commit()
    return {"message": "Đã xóa scheduled task"}


@router.post("/{schedule_id}/trigger", response_model=ScheduledTaskOut, tags=["Schedules"])
def trigger_schedule(
    schedule_id: int,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Manually trigger a scheduled task to run immediately."""
    st = db.query(ScheduledTask).filter(
        ScheduledTask.id == schedule_id,
        ScheduledTask.user_id == user_id,
    ).first()
    if not st:
        raise HTTPException(status_code=404, detail="Scheduled task not found")

    import datetime
    now = datetime.datetime.now(datetime.UTC)

    # Set next_run_at to now so the scheduler picks it up immediately
    st.next_run_at = now
    db.commit()
    db.refresh(st)

    out = ScheduledTaskOut.from_orm(st)
    out.temperature = (st.temperature or 5) / 10.0
    return out


@router.post("/{schedule_id}/toggle", response_model=ScheduledTaskOut, tags=["Schedules"])
def toggle_schedule(
    schedule_id: int,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Toggle enabled/disabled state of a scheduled task."""
    st = db.query(ScheduledTask).filter(
        ScheduledTask.id == schedule_id,
        ScheduledTask.user_id == user_id,
    ).first()
    if not st:
        raise HTTPException(status_code=404, detail="Scheduled task not found")

    st.is_enabled = not st.is_enabled
    if st.is_enabled:
        st.next_run_at = ScheduleRunner.compute_next_run(st.cron_expression)

    db.commit()
    db.refresh(st)

    out = ScheduledTaskOut.from_orm(st)
    out.temperature = (st.temperature or 5) / 10.0
    return out
