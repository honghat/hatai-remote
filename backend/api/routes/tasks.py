"""
AI Task Queue Routes — submit and manage background AI agent tasks
"""
import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.llm_engine import LLMEngine
from core.security import get_current_user
from core.task_runner import TaskRunner
from db.psql.session import get_db
from db.psql.models.task import AITask
from schemas.task import AITaskCreate, AITaskOut, TaskLogOut

router = APIRouter()

@router.post("", response_model=AITaskOut, tags=["Tasks"])
def create_task(
    data: AITaskCreate,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create and start a new background agent task."""
    engine = LLMEngine.get()
    if not engine.is_ready:
        raise HTTPException(status_code=503, detail="Model chưa sẵn sàng")

    from crud.chat_service import ChatService
    from schemas.chat import ChatSessionCreate
    svc = ChatService(db)
    
    session_id = data.session_id
    if session_id:
        # Verify the session actually exists in DB to prevent IntegrityError
        if not svc.get_session(session_id, user_id):
            session_id = None

    if not session_id:
        title = f"🤖 {data.prompt[:45]}"
        session = svc.create_session(user_id, ChatSessionCreate(title=title))
        session_id = session.id

    task = AITask(
        user_id=user_id, 
        prompt=data.prompt, 
        session_id=session_id, 
        status="pending", 
        model_name=engine.provider
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # Start the task using the TaskRunner singleton
    runner = TaskRunner.get()
    runner.start_task(
        task_id=task.id, 
        user_id=user_id, 
        prompt=data.prompt, 
        session_id=session_id,
        temperature=data.temperature,
        max_tokens=data.max_tokens,
        attachments=data.attachments
    )

    # Update state to running
    task.status = "running"
    
    # Return enriched response via schema
    resp = AITaskOut.from_orm(task)
    resp.progress = 0
    return resp


@router.get("", response_model=List[AITaskOut], tags=["Tasks"])
def list_tasks(user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    """List all past and present tasks for user."""
    tasks = db.query(AITask).filter(AITask.user_id == user_id).order_by(AITask.created_at.desc()).all()

    runner = TaskRunner.get()
    results = []
    dirty = False

    for t in tasks:
        out = AITaskOut.from_orm(t)
        # Only check TaskRunner for active tasks
        if out.status in ("pending", "running"):
            live = runner.get_task(t.id)
            if live:
                out.status = live.status.value
                out.progress = live.progress
            else:
                # Orphaned — mark as error
                out.status = "error"
                t.status = "error"
                t.result = "Task died unexpectedly."
                dirty = True
        results.append(out)

    if dirty:
        db.commit()

    return results


@router.get("/{task_id}", response_model=AITaskOut, tags=["Tasks"])
def get_task(task_id: int, user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get precise task status."""
    t = db.query(AITask).filter(AITask.id == task_id, AITask.user_id == user_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Task không tồn tại")

    out = AITaskOut.from_orm(t)
    if out.status in ("pending", "running"):
        live = TaskRunner.get().get_task(task_id)
        if live:
            out.status = live.status.value
            out.progress = live.progress
    return out


@router.get("/{task_id}/logs", response_model=List[TaskLogOut], tags=["Tasks"])
def stream_task_logs(
    task_id: int, 
    since: int = 0, 
    user_id: int = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    """Poll for new logs of a running task."""
    t = db.query(AITask).filter(AITask.id == task_id, AITask.user_id == user_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Task không tồn tại")
        
    live = TaskRunner.get().get_task(task_id)
    if live:
        return TaskRunner.get().get_logs(task_id, since_index=since)
        
    # Task already finished & removed from memory, or never started
    if t.status in ("done", "error", "cancelled"):
        # We don't persist all tiny step logs in DB, just the final result
        if since == 0 and t.result:
            return [{
                "index": 0,
                "timestamp": datetime.datetime.now().timestamp(),
                "type": "text",
                "content": str(t.result),
                "tool": "",
                "args": {},
                "result": None
            }]
    return []


@router.post("/{task_id}/cancel", tags=["Tasks"])
def cancel_task(task_id: int, user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cancel a running task immediately."""
    t = db.query(AITask).filter(AITask.id == task_id, AITask.user_id == user_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Task không tồn tại")
        
    if t.status in ("done", "error", "cancelled"):
        return {"message": "Task đã kết thúc, không thể huỷ."}
        
    runner = TaskRunner.get()
    cancelled = runner.cancel_task(task_id)
    
    t.status = "cancelled"
    t.completed_at = datetime.datetime.now(datetime.UTC)
    db.commit()
    
    return {"message": "Đã gửi lệnh huỷ task."}


@router.post("/{task_id}/rerun", response_model=AITaskOut, tags=["Tasks"])
def rerun_task(task_id: int, user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    """Re-run a completed/failed/cancelled task with the same prompt."""
    original = db.query(AITask).filter(AITask.id == task_id, AITask.user_id == user_id).first()
    if not original:
        raise HTTPException(status_code=404, detail="Task không tồn tại")
    if original.status in ("pending", "running"):
        raise HTTPException(status_code=400, detail="Task đang chạy, không cần chạy lại")

    engine = LLMEngine.get()
    if not engine.is_ready:
        raise HTTPException(status_code=503, detail="Model chưa sẵn sàng")

    # Create new task with same prompt and session
    task = AITask(
        user_id=user_id,
        prompt=original.prompt,
        session_id=original.session_id,
        status="pending",
        model_name=engine.provider,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    TaskRunner.get().start_task(task.id, user_id, task.prompt, session_id=task.session_id)
    task.status = "running"

    resp = AITaskOut.from_orm(task)
    resp.progress = 0
    return resp


@router.delete("/{task_id}", tags=["Tasks"])
def delete_task(task_id: int, user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    """Hard delete task and stop if running."""
    t = db.query(AITask).filter(AITask.id == task_id, AITask.user_id == user_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Task không tồn tại")
        
    # Stop before deleting
    TaskRunner.get().remove_task(task_id)
    
    db.delete(t)
    db.commit()
    return {"message": "Đã xóa task"}


@router.delete("", tags=["Tasks"])
def delete_all_tasks(user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete all tasks for the current user."""
    # 1. Stop all from memory
    TaskRunner.get().clear_all_tasks(user_id)
    
    # 2. Delete from DB
    db.query(AITask).filter(AITask.user_id == user_id).delete()
    db.commit()
    
    return {"message": "Đã xóa tất cả các task."}
