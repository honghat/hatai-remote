"""
TaskRunner — Background task executor that runs agent tasks independently from chat.

Each task runs in its own daemon thread using the full AgentExecutor loop.
Tasks persist through page navigation and only stop when explicitly cancelled or deleted.

Architecture:
- Singleton TaskRunner manages all running tasks
- Each task gets its own thread + cancel_event
- Logs are buffered in-memory for real-time streaming via polling
- Results are persisted to PostgreSQL on completion
"""
import datetime
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Any

logger = logging.getLogger("TaskRunner")


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


@dataclass
class TaskLog:
    """A single log entry from a running task."""
    timestamp: float
    type: str  # text, thinking, tool_call, tool_result, error, done, screenshot
    content: str = ""
    tool: str = ""
    args: Dict = field(default_factory=dict)
    result: Any = None


@dataclass
class RunningTask:
    """In-memory representation of a running/completed task."""
    task_id: int
    user_id: int
    prompt: str
    status: TaskStatus = TaskStatus.PENDING
    thread: Optional[threading.Thread] = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    logs: List[TaskLog] = field(default_factory=list)
    logs_lock: threading.Lock = field(default_factory=threading.Lock)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    result_summary: str = ""
    progress: int = 0  # 0-100
    session_id: Optional[int] = None
    temperature: float = 0.5
    max_tokens: int = 2048
    attachments: List[Dict[str, Any]] = field(default_factory=list)


class TaskRunner:
    """Singleton background task manager."""

    _instance: Optional["TaskRunner"] = None
    _lock = threading.Lock()

    def __init__(self):
        self._tasks: Dict[int, RunningTask] = {}
        self._tasks_lock = threading.Lock()

    @classmethod
    def get(cls) -> "TaskRunner":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    # ── Task Lifecycle ────────────────────────────────────────────────────────

    def start_task(
        self, 
        task_id: int, 
        user_id: int, 
        prompt: str, 
        session_id: Optional[int] = None,
        temperature: float = 0.5,
        max_tokens: int = 2048,
        attachments: Optional[List[Dict[str, Any]]] = None
    ) -> RunningTask:
        """Start a new background task using the agent executor."""
        running = RunningTask(
            task_id=task_id,
            user_id=user_id,
            prompt=prompt,
            status=TaskStatus.PENDING,
            session_id=session_id,
            temperature=temperature,
            max_tokens=max_tokens,
            attachments=attachments or []
        )

        with self._tasks_lock:
            # Cancel existing task with same ID if any
            if task_id in self._tasks:
                old = self._tasks[task_id]
                old.cancel_event.set()
            self._tasks[task_id] = running

        thread = threading.Thread(
            target=self._run_task,
            args=(running,),
            daemon=True,
            name=f"Task-{task_id}",
        )
        running.thread = thread
        thread.start()

        logger.info(f"🚀 Task {task_id} started: {prompt[:80]}")
        return running

    def cancel_task(self, task_id: int) -> bool:
        """Cancel a running task."""
        with self._tasks_lock:
            running = self._tasks.get(task_id)

        if running and running.status == TaskStatus.RUNNING:
            running.cancel_event.set()
            logger.info(f"🛑 Task {task_id} cancel signal sent")
            return True
        return False

    def remove_task(self, task_id: int):
        """Remove task from memory (cancel first if running)."""
        self.cancel_task(task_id)
        with self._tasks_lock:
            self._tasks.pop(task_id, None)
        logger.info(f"🗑️ Task {task_id} removed from memory")

    def get_task(self, task_id: int) -> Optional[RunningTask]:
        with self._tasks_lock:
            return self._tasks.get(task_id)

    def get_user_tasks(self, user_id: int) -> List[RunningTask]:
        with self._tasks_lock:
            return [t for t in self._tasks.values() if t.user_id == user_id]

    def clear_all_tasks(self, user_id: int):
        """Cancel and remove all tasks belonging to a specific user."""
        user_tasks = self.get_user_tasks(user_id)
        for t in user_tasks:
            self.remove_task(t.task_id)
        logger.info(f"🧹 All tasks for user {user_id} cleared from memory")

    def get_logs(self, task_id: int, since_index: int = 0) -> List[Dict]:
        """Get task logs starting from index. Used for polling/streaming."""
        running = self.get_task(task_id)
        if not running:
            return []
        
        with running.logs_lock:
            logs = running.logs[since_index:]
        
        return [
            {
                "index": since_index + i,
                "timestamp": log.timestamp,
                "type": log.type,
                "content": log.content,
                "tool": log.tool,
                "args": log.args,
                "result": _truncate_result(log.result) if log.result else None,
            }
            for i, log in enumerate(logs)
        ]

    # ── Internal Execution ────────────────────────────────────────────────────

    def _run_task(self, task: RunningTask):
        """Execute a task using the full agent executor loop."""
        from core.agent_executor import run_agent
        from db.psql.session import SessionLocal

        task.status = TaskStatus.RUNNING
        task.started_at = time.time()
        # No more "Task started..." log to keep chat clean
        self._update_db(task.task_id, status="running")

        db = SessionLocal()
        full_response_parts = []
        tool_count = 0
        from core.agent_executor import stringify_agent_event
            
        # Load history if session_id is provided
        history = []
        if task.session_id:
            try:
                from crud.chat_service import ChatService
                svc = ChatService(db)
                history_msgs = svc.get_messages(task.session_id)
                for m in history_msgs[-20:]:  # Last 20 messages for context
                    history.append({"role": m.role, "content": m.content})
                # Add user message to history in DB with attachments
                att_json = json.dumps(task.attachments) if task.attachments else None
                svc.add_message(task.session_id, "user", task.prompt, attachments=att_json)
            except Exception as e:
                logger.error(f"Failed to load history for task {task.task_id}: {e}")

        try:
            for event in run_agent(
                user_message=task.prompt,
                history=history,
                max_tokens=task.max_tokens or 4096,
                temperature=task.temperature or 0.5,
                cancel_event=task.cancel_event,
                session_id=task.session_id,
                attachments=task.attachments
            ):
                if task.cancel_event.is_set():
                    task.status = TaskStatus.CANCELLED
                    self._add_log(task, "text", "⏹️ Task cancelled by user.")
                    break

                if not isinstance(event, dict):
                    continue

                etype = event.get("type", "")
                
                # STRINGIFY for persistent history
                if etype != "thinking_token":
                    s_event = stringify_agent_event(event)
                    if s_event:
                        full_response_parts.append(s_event)

                if etype == "text":
                    content = event.get("content", "")
                    self._add_log(task, "text", content)

                elif etype == "thinking":
                    self._add_log(task, "thinking", event.get("content", ""))

                elif etype == "thinking_token":
                    # Accumulate thinking tokens
                    self._add_log(task, "thinking_token", event.get("content", ""))

                elif etype == "tool_call":
                    tool_count += 1
                    tool_name = event.get("tool", "")
                    args = event.get("args", {})
                    self._add_log(task, "tool_call", f"🔧 {tool_name}", tool=tool_name, args=args)
                    # Estimate progress (rough: each tool call = ~5%)
                    task.progress = min(95, tool_count * 5)

                elif etype == "tool_result":
                    tool_name = event.get("tool", "")
                    result = event.get("result", {})
                    self._add_log(task, "tool_result", "", tool=tool_name, result=result)

                elif etype == "screenshot":
                    path = event.get("path", "")
                    url = event.get("url", f"/agent/screenshots/{path.split('/')[-1]}" if path else "")
                    self._add_log(task, "screenshot", url)

                elif etype == "error":
                    self._add_log(task, "error", event.get("content", "Unknown error"))

                elif etype == "done":
                    break

            # Task completed
            if task.status == TaskStatus.RUNNING:
                task.status = TaskStatus.DONE
                task.progress = 100
                self._add_log(task, "done", "✅ Task completed successfully.")
            
            # Small yield to ensure async loops/generators flush
            time.sleep(0.1)

        except Exception as e:
            import traceback
            logger.error(f"❌ Task {task.task_id} error: {e}\n{traceback.format_exc()}")
            task.status = TaskStatus.ERROR
            self._add_log(task, "error", f"❌ Fatal error: {str(e)}")

        finally:
            task.finished_at = time.time()
            # Ensure all parts are strings to avoid TypeError
            result_text = "".join([str(p) for p in full_response_parts])
            
            # Persist to DB
            try:
                self._update_db(
                    task.task_id,
                    status=task.status.value,
                    result=result_text[:50000] if result_text else "",
                    completed_at=datetime.datetime.now(datetime.UTC),
                )
                
                # If it was a chat task, inject final result message back to chat
                if task.session_id:
                    from crud.chat_service import ChatService
                    # Re-initialize Session to avoid thread/closed issues
                    from db.psql.session import SessionLocal
                    db_save = SessionLocal()
                    try:
                        svc = ChatService(db_save)
                        # Build a final report
                        report_header = f"✅ **Background Task #{task.task_id} Completed!**\n\n" if task.status == TaskStatus.DONE else f"⏹️ **Background Task #{task.task_id} Stopped.**\n\n"
                        final_msg = report_header + result_text
                        
                        msg_model = svc.add_message(task.session_id, "assistant", final_msg)
                        db_save.commit() # Explicit commit for safety
                        logger.info(f"✅ Result for task {task.task_id} saved to chat {task.session_id} (msg_id: {msg_model.id}, length: {len(final_msg)})")
                        
                        # Tell UI to update instantly - ONLY after commit
                        from core.agent_daemon import AgentDaemon
                        AgentDaemon.get()._broadcast_sync({
                            "type": "task_result",
                            "task_id": task.task_id,
                            "session_id": task.session_id,
                            "result": result_text
                        })
                    finally:
                        db_save.close()
            except Exception as e:
                logger.error(f"Post-task persistence failed for task {task.task_id}: {e}")
            finally:
                if 'db' in locals():
                    db.close()
            
            elapsed = task.finished_at - (task.started_at or task.finished_at)
            logger.info(f"🏁 Task {task.task_id} finished ({task.status.value}) in {elapsed:.1f}s")

    def _add_log(self, task: RunningTask, log_type: str, content: str = "",
                 tool: str = "", args: Dict = None, result: Any = None):
        """Thread-safe log append."""
        entry = TaskLog(
            timestamp=time.time(),
            type=log_type,
            content=content,
            tool=tool,
            args=args or {},
            result=result,
        )
        with task.logs_lock:
            task.logs.append(entry)

        # Broadcast to any connected WebSockets for real-time UI updates
        try:
            from core.agent_daemon import AgentDaemon
            AgentDaemon.get()._broadcast_sync({
                "type": "task_log",
                "task_id": task.task_id,
                "session_id": task.session_id,
                "log": {
                    "index": len(task.logs) - 1,
                    "timestamp": entry.timestamp,
                    "type": entry.type,
                    "content": entry.content,
                    "tool": entry.tool,
                    "args": entry.args,
                    "result": entry.result
                }
            })
        except:
            pass

    def _update_db(self, task_id: int, **fields):
        """Update task fields in PostgreSQL."""
        try:
            from db.psql.session import SessionLocal
            from db.psql.models.task import AITask
            db_tmp = SessionLocal()
            try:
                db_tmp.query(AITask).filter(AITask.id == task_id).update(fields)
                db_tmp.commit()
            finally:
                db_tmp.close()
        except Exception as e:
            logger.error(f"Failed to update task {task_id}: {e}")


def _truncate_result(result: Any, max_len: int = 2000) -> Any:
    """Truncate large tool results for log streaming."""
    if isinstance(result, dict):
        result_str = json.dumps(result, ensure_ascii=False, default=str)
        if len(result_str) > max_len:
            # Simplify: keep key fields only
            simplified = {}
            for k, v in result.items():
                if k in ("base64", "_frontend_screenshot"):
                    simplified[k] = "[image data]"
                elif isinstance(v, str) and len(v) > 500:
                    simplified[k] = v[:500] + "... [truncated]"
                else:
                    simplified[k] = v
            return simplified
        return result
    elif isinstance(result, str) and len(result) > max_len:
        return result[:max_len] + "... [truncated]"
    return result
