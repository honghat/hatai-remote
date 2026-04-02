"""
Agent Daemon — Persistent background agent that stays alive and listens for commands.

States:
- IDLE: Waiting for commands (heartbeat every 5s)
- RUNNING: Executing a task
- PAUSED: Temporarily paused by user

The daemon runs as a singleton background thread. Commands are sent via a thread-safe queue.
Results are broadcast to all connected WebSocket clients in real-time.
"""
import asyncio
import json
import logging
import threading
import time
from enum import Enum
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field

logger = logging.getLogger("AgentDaemon")


class DaemonState(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPED = "stopped"


@dataclass
class DaemonCommand:
    """A command sent to the daemon."""
    type: str  # "task", "pause", "resume", "stop", "status"
    message: str = ""
    session_id: Optional[int] = None
    user_id: Optional[int] = None
    max_tokens: int = 18192
    temperature: float = 0.5
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TaskContext:
    """In-memory state for a single running agent task."""
    session_id: int
    cancel_event: threading.Event = field(default_factory=threading.Event)
    pause_event: threading.Event = field(default_factory=threading.Event)
    inject_queue: List[str] = field(default_factory=list)
    inject_lock: threading.Lock = field(default_factory=threading.Lock)
    status: DaemonState = DaemonState.RUNNING

    def __post_init__(self):
        self.pause_event.set()


class AgentDaemon:
    """Singleton persistent agent daemon (Multi-Agent Parallel Version)."""

    _instance: Optional["AgentDaemon"] = None
    _lock = threading.Lock()

    def __init__(self):
        self.state = DaemonState.STOPPED
        self._command_queue: List[DaemonCommand] = []
        self._queue_lock = threading.Lock()
        self._queue_event = threading.Event()  # signals new command available
        self._thread: Optional[threading.Thread] = None
        self._event_loop: Optional[asyncio.AbstractEventLoop] = None

        # Multi-task state management
        self._active_tasks: Dict[int, TaskContext] = {} # session_id -> context
        self._tasks_lock = threading.Lock()

        # Connected WebSocket clients for broadcasting: {ws: Lock}
        self._ws_clients: Dict[Any, asyncio.Lock] = {}
        self._ws_lock = threading.Lock()

        # Stats
        self.tasks_completed: int = 0
        self.started_at: Optional[float] = None
        self.last_activity: Optional[float] = None

        # History buffer for reconnecting clients
        self._event_buffer: List[Dict] = []
        self._buffer_max = 200

    @classmethod
    def get(cls) -> "AgentDaemon":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self, event_loop: asyncio.AbstractEventLoop = None):
        """Start the daemon background thread."""
        if self._thread and self._thread.is_alive():
            logger.info("🟢 Daemon already running")
            return

        self._event_loop = event_loop
        self.state = DaemonState.IDLE
        self.started_at = time.time()

        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="AgentDaemon")
        self._thread.start()
        logger.info("🟢 Agent Daemon started — listening for commands")
        self._broadcast_sync({"type": "daemon_status", "state": "idle", "message": "Agent daemon đã khởi động, sẵn sàng nhận lệnh."})

    def stop(self):
        """Stop the daemon entirely and all running tasks."""
        self.state = DaemonState.STOPPED
        with self._tasks_lock:
            for ctx in self._active_tasks.values():
                ctx.cancel_event.set()
                ctx.pause_event.set()
        self._queue_event.set()  # unblock if waiting
        logger.info("🔴 Agent Daemon stopped (all tasks cancelled)")
        self._broadcast_sync({"type": "daemon_status", "state": "stopped", "message": "Agent daemon đã tắt."})

    def pause(self, session_id: int = None):
        """Pause a specific session or all running ones."""
        with self._tasks_lock:
            tasks = [self._active_tasks[session_id]] if session_id and session_id in self._active_tasks else self._active_tasks.values()
            for ctx in tasks:
                ctx.pause_event.clear()
                ctx.status = DaemonState.PAUSED
                logger.info(f"⏸️ Task in session {ctx.session_id} paused")
        self._broadcast_sync({"type": "daemon_status", "state": "paused", "session_id": session_id})

    def resume(self, session_id: int = None):
        """Resume a specific session or all running ones."""
        with self._tasks_lock:
            tasks = [self._active_tasks[session_id]] if session_id and session_id in self._active_tasks else self._active_tasks.values()
            for ctx in tasks:
                ctx.pause_event.set()
                ctx.status = DaemonState.RUNNING
                logger.info(f"▶️ Task in session {ctx.session_id} resumed")
        self._broadcast_sync({"type": "daemon_status", "state": "running", "session_id": session_id})

    def cancel_current(self, session_id: int = None):
        """Cancel a specific session or the most recent one."""
        target_ctx = None
        with self._tasks_lock:
            if session_id and session_id in self._active_tasks:
                target_ctx = self._active_tasks[session_id]
            elif self._active_tasks:
                # Cancel the last added task
                last_id = list(self._active_tasks.keys())[-1]
                target_ctx = self._active_tasks[last_id]
        
        if target_ctx:
            target_ctx.cancel_event.set()
            target_ctx.pause_event.set() # unblock if paused to allow exit
            logger.info(f"🛑 Task in session {target_ctx.session_id} cancelled")
            self._broadcast_sync({
                "type": "daemon_status", 
                "state": "cancelling", 
                "session_id": target_ctx.session_id,
                "message": f"Đang dừng tác vụ trong session {target_ctx.session_id}..."
            })

    def inject_message(self, message: str, session_id: int = None):
        """Inject a user message into a specific running task context."""
        target_ctx = None
        with self._tasks_lock:
            if session_id and session_id in self._active_tasks:
                target_ctx = self._active_tasks[session_id]
            elif self._active_tasks:
                # Inject into the most recent task
                last_id = list(self._active_tasks.keys())[-1]
                target_ctx = self._active_tasks[last_id]
        
        if target_ctx:
            with target_ctx.inject_lock:
                target_ctx.inject_queue.append(message)
            logger.info(f"💉 Injected into session {target_ctx.session_id}: {message[:50]}")
            self._broadcast_sync({
                "type": "user_inject",
                "session_id": target_ctx.session_id,
                "content": message,
            })

    def pop_injected_messages(self, session_id: int) -> List[str]:
        """Pop all pending injected messages for a specific session."""
        with self._tasks_lock:
            ctx = self._active_tasks.get(session_id)
            if not ctx:
                return []
            with ctx.inject_lock:
                msgs = list(ctx.inject_queue)
                ctx.inject_queue.clear()
            return msgs

    # ── Command Queue ─────────────────────────────────────────────────────────

    def send_command(self, cmd: DaemonCommand):
        """Queue a command for the daemon to process."""
        with self._queue_lock:
            self._command_queue.append(cmd)
        self._queue_event.set()
        logger.info(f"📥 Command queued: {cmd.type} — {cmd.message[:80] if cmd.message else ''}")

    def get_queue_size(self) -> int:
        with self._queue_lock:
            return len(self._command_queue)

    def _pop_command(self) -> Optional[DaemonCommand]:
        with self._queue_lock:
            if self._command_queue:
                return self._command_queue.pop(0)
        return None

    # ── WebSocket Management ──────────────────────────────────────────────────

    def register_ws(self, ws):
        with self._ws_lock:
            self._ws_clients[ws] = asyncio.Lock()
        logger.info(f"🔗 WebSocket client connected (total: {len(self._ws_clients)})")

    def unregister_ws(self, ws):
        with self._ws_lock:
            if ws in self._ws_clients:
                del self._ws_clients[ws]
        logger.info(f"🔌 WebSocket client disconnected (total: {len(self._ws_clients)})")

    def get_event_buffer(self) -> List[Dict]:
        """Return recent events for reconnecting clients."""
        return list(self._event_buffer)

    def _broadcast_sync(self, event: Dict):
        """Thread-safe broadcast to all WebSocket clients."""
        # Buffer the event
        self._event_buffer.append(event)
        if len(self._event_buffer) > self._buffer_max:
            self._event_buffer = self._event_buffer[-self._buffer_max:]

        self.last_activity = time.time()

        if not self._event_loop or not self._ws_clients:
            return

        with self._ws_lock:
            clients = dict(self._ws_clients)

        for ws, lock in clients.items():
            asyncio.run_coroutine_threadsafe(
                self._send_locked(ws, lock, event),
                self._event_loop,
            )

    async def _send_locked(self, ws, lock, event: Dict):
        """Async helper to send a message sequentially using a lock."""
        async with lock:
            try:
                await ws.send_json(event)
            except Exception:
                # Client probably disconnected
                self.unregister_ws(ws)

    # ── Main Loop ─────────────────────────────────────────────────────────────

    def _run_loop(self):
        """Main daemon loop — runs forever until stopped."""
        logger.info("🔄 Daemon loop started")
        heartbeat_interval = 5.0
        last_heartbeat = 0

        while self.state != DaemonState.STOPPED:
            # Wait for a command or heartbeat timeout
            self._queue_event.wait(timeout=heartbeat_interval)
            self._queue_event.clear()

            if self.state == DaemonState.STOPPED:
                break

            # Send heartbeat when idle
            now = time.time()
            if self.state == DaemonState.IDLE and (now - last_heartbeat) >= heartbeat_interval:
                last_heartbeat = now
                self._broadcast_sync({
                    "type": "heartbeat",
                    "state": self.state.value,
                    "uptime": int(now - self.started_at) if self.started_at else 0,
                    "tasks_completed": self.tasks_completed,
                    "queue_size": self.get_queue_size(),
                })

            # Process commands
            cmd = self._pop_command()
            if cmd is None:
                continue

            if cmd.type == "task":
                # Start new task in a background thread for parallel execution
                t = threading.Thread(
                    target=self._execute_task, 
                    args=(cmd,), 
                    daemon=True,
                    name=f"AgentTask-{cmd.session_id or 'anon'}"
                )
                t.start()
            elif cmd.type == "pause":
                self.pause(cmd.session_id)
            elif cmd.type == "resume":
                self.resume(cmd.session_id)
            elif cmd.type == "stop":
                self.stop()
                break
            elif cmd.type == "cancel":
                self.cancel_current(cmd.session_id)

        logger.info("🔄 Daemon loop exited")

    def _execute_task(self, cmd: DaemonCommand):
        """Execute a single agent task in its own thread."""
        from core.agent_executor import run_agent, stringify_agent_event
        from core.llm_engine import LLMEngine
        from db.psql.session import SessionLocal
        from crud.chat_service import ChatService
        from schemas.chat import ChatSessionCreate

        engine = LLMEngine.get()
        if not engine.is_ready:
            self._broadcast_sync({"type": "error", "content": f"LLM ({engine.provider}) chưa sẵn sàng."})
            return

        # 1. Load or create session
        session_id = cmd.session_id
        history = []
        db = SessionLocal()
        try:
            svc = ChatService(db)
            if not session_id and cmd.user_id:
                title = f"🤖 {cmd.message[:45]}"
                session = svc.create_session(cmd.user_id, ChatSessionCreate(title=title))
                session_id = session.id
                cmd.session_id = session_id
                self._broadcast_sync({"type": "session", "session_id": session_id})

            if session_id:
                history_msgs = svc.get_messages(session_id)
                for m in history_msgs[-100:]:
                    history.append({"role": m.role, "content": m.content})
                svc.add_message(session_id, "user", cmd.message)
        except Exception as e:
            logger.error(f"Failed to load/create session: {e}")
        finally:
            db.close()

        # 2. Register Task Context
        # Use session_id or a unique timestamp as key
        task_key = session_id or int(time.time() * 1000)
        ctx = TaskContext(session_id=task_key)
        with self._tasks_lock:
            self._active_tasks[task_key] = ctx

        logger.info(f"🚀 Starting parallel task for session {task_key}")
        
        self._broadcast_sync({
            "type": "daemon_status",
            "state": "running",
            "session_id": session_id,
            "message": f"Đang thực thi: {cmd.message[:100]}",
            "task": cmd.message,
        })

        # 3. Run the agent
        full_response_parts = []
        try:
            for event in run_agent(
                user_message=cmd.message,
                history=history,
                max_tokens=cmd.max_tokens,
                temperature=cmd.temperature,
                cancel_event=ctx.cancel_event,
                session_id=session_id,
            ):
                # Check pause/resume
                ctx.pause_event.wait()

                if self.state == DaemonState.STOPPED or ctx.cancel_event.is_set():
                    self._broadcast_sync({"type": "text", "session_id": session_id, "content": "⏹️ Đã dừng tác vụ."})
                    break

                if not isinstance(event, dict):
                    continue

                # Ensure session_id is in every event for frontend routing
                if session_id:
                    event["session_id"] = session_id

                # ── Truncate/Strip large data ──
                if event.get("type") == "tool_result":
                    res_obj = event.get("result")
                    if isinstance(res_obj, dict):
                        # Truncate content/stdout if too long
                        if "content" in res_obj and isinstance(res_obj["content"], str) and len(res_obj["content"]) > 1000:
                            res_obj["content"] = res_obj["content"][:1000] + "... [truncated]"
                        if "stdout" in res_obj and isinstance(res_obj["stdout"], str) and len(res_obj["stdout"]) > 1000:
                            res_obj["stdout"] = res_obj["stdout"][:1000] + "... [truncated]"

                        # If result carries a frontend screenshot, broadcast as a separate
                        # screenshot event WITH the base64 data so the UI can render it.
                        # Then strip from the result to avoid polluting history.
                        if "_frontend_screenshot" in res_obj:
                            b64 = res_obj["_frontend_screenshot"]
                            path = res_obj.get("_frontend_screenshot_path", "")
                            if b64 and b64 != "[image]":
                                scr_event = {
                                    "type": "tool_result_screenshot",
                                    "base64": b64,
                                    "path": path,
                                    "session_id": session_id,
                                }
                                self._broadcast_sync(scr_event)
                                # Save a screenshot marker to history
                                if path:
                                    filename = path.split("/")[-1]
                                    full_response_parts.append(f"\n📸 Screenshot: {path}\n")
                            # Strip the large base64 from result before saving/logging
                            res_obj.pop("_frontend_screenshot", None)
                            res_obj.pop("_frontend_screenshot_path", None)

                # Track response text for persistence (exclude plan and thinking tokens)
                if event.get("type") != "thinking_token" and not event.get("is_plan"):
                    full_response_parts.append(stringify_agent_event(event))

                # Broadcast to WebSocket clients
                self._broadcast_sync(event)

            # 4. Save response to DB
            if session_id and full_response_parts:
                try:
                    db_save = SessionLocal()
                    try:
                        svc = ChatService(db_save)
                        full_text = "".join(full_response_parts)
                        if full_text.strip():
                            svc.add_message(session_id, "assistant", full_text)
                    finally:
                        db_save.close()
                except Exception as e:
                    logger.error(f"Failed to save parallel response: {e}")

        except Exception as e:
            import traceback
            logger.error(f"❌ Parallel Task Error (session {session_id}): {e}\n{traceback.format_exc()}")
            self._broadcast_sync({"type": "error", "session_id": session_id, "content": f"Lỗi: {str(e)}"})

        finally:
            # 5. Cleanup
            with self._tasks_lock:
                self._active_tasks.pop(task_key, None)
            
            self.tasks_completed += 1
            
            logger.info(f"🏁 Task for session {task_key} finished (Total completed: {self.tasks_completed})")
            
            self._broadcast_sync({
                "type": "daemon_status",
                "state": "idle" if not self._active_tasks else "running",
                "session_id": session_id,
                "message": "Tác vụ hoàn thành.",
                "tasks_completed": self.tasks_completed,
            })
            self._broadcast_sync({"type": "done", "session_id": session_id})

    # ── Status ────────────────────────────────────────────────────────────────

    def get_status(self) -> Dict[str, Any]:
        """Get current daemon status including active tasks."""
        with self._tasks_lock:
            active_sessions = list(self._active_tasks.keys())
            
        return {
            "state": self.state.value,
            "active_tasks_count": len(active_sessions),
            "active_sessions": active_sessions,
            "tasks_completed": self.tasks_completed,
            "queue_size": self.get_queue_size(),
            "uptime": int(time.time() - self.started_at) if self.started_at else 0,
            "connected_clients": len(self._ws_clients),
            "last_activity": self.last_activity,
        }
