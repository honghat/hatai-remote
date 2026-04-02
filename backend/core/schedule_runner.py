"""
ScheduleRunner — Background cron scheduler for periodic AI tasks.

Architecture:
- Singleton running in a daemon thread
- Polls DB every 15 seconds for due tasks
- Executes due tasks via TaskRunner (reuses existing infra)
- Updates next_run_at after each execution
- Thread-safe, graceful shutdown
"""
import datetime
import logging
import threading
import time
from typing import Optional

from croniter import croniter

logger = logging.getLogger("ScheduleRunner")


class ScheduleRunner:
    """Background scheduler that triggers periodic AI tasks."""

    _instance: Optional["ScheduleRunner"] = None
    _lock = threading.Lock()

    POLL_INTERVAL = 15  # seconds between DB polls

    def __init__(self):
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._running_schedule_ids: set = set()  # prevent double-firing
        self._runs_lock = threading.Lock()

    @classmethod
    def get(cls) -> "ScheduleRunner":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self):
        """Start the scheduler background thread."""
        if self.is_running:
            logger.warning("ScheduleRunner already running")
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            daemon=True,
            name="ScheduleRunner",
        )
        self._thread.start()
        logger.info("ScheduleRunner started")

    def stop(self):
        """Stop the scheduler gracefully."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        self._thread = None
        logger.info("ScheduleRunner stopped")

    def _run_loop(self):
        """Main scheduler loop — poll DB for due tasks."""
        # Wait a bit for app startup
        time.sleep(3)

        while not self._stop_event.is_set():
            try:
                self._check_and_execute()
            except Exception as e:
                logger.error(f"ScheduleRunner error: {e}", exc_info=True)

            # Sleep in small increments for responsive shutdown
            for _ in range(self.POLL_INTERVAL):
                if self._stop_event.is_set():
                    return
                time.sleep(1)

    def _check_and_execute(self):
        """Check for due scheduled tasks and fire them."""
        from db.psql.session import SessionLocal
        from db.psql.models.scheduled_task import ScheduledTask

        now = datetime.datetime.now(datetime.UTC)
        db = SessionLocal()
        try:
            due_tasks = (
                db.query(ScheduledTask)
                .filter(
                    ScheduledTask.is_enabled == True,
                    ScheduledTask.next_run_at <= now,
                )
                .all()
            )

            for st in due_tasks:
                # Skip if already executing
                with self._runs_lock:
                    if st.id in self._running_schedule_ids:
                        continue
                    self._running_schedule_ids.add(st.id)

                logger.info(f"Firing scheduled task #{st.id} '{st.name}' (cron: {st.cron_expression})")

                # Calculate next_run_at immediately so we don't double-fire
                cron = croniter(st.cron_expression, now)
                st.next_run_at = cron.get_next(datetime.datetime)
                st.last_run_at = now
                db.commit()

                # Execute in a separate thread
                thread = threading.Thread(
                    target=self._execute_scheduled,
                    args=(st.id, st.user_id, st.prompt, st.max_tokens, st.temperature),
                    daemon=True,
                    name=f"Sched-{st.id}",
                )
                thread.start()
        finally:
            db.close()

    def _execute_scheduled(self, schedule_id: int, user_id: int, prompt: str,
                           max_tokens: int, temperature_int: int):
        """Execute a single scheduled task run."""
        from db.psql.session import SessionLocal
        from db.psql.models.scheduled_task import ScheduledTask
        from db.psql.models.task import AITask
        from core.task_runner import TaskRunner
        from core.llm_engine import LLMEngine

        engine = LLMEngine.get()
        if not engine.is_ready:
            logger.warning(f"Scheduled task #{schedule_id} skipped — model not ready")
            self._finish_schedule(schedule_id, "error", "Model not ready")
            return

        db = SessionLocal()
        try:
            # Create a one-off AITask for tracking
            from crud.chat_service import ChatService
            from schemas.chat import ChatSessionCreate
            svc = ChatService(db)

            title = f"Scheduled: {prompt[:40]}"
            session = svc.create_session(user_id, ChatSessionCreate(title=title))

            task = AITask(
                user_id=user_id,
                prompt=f"[Scheduled Task] {prompt}",
                session_id=session.id,
                status="pending",
                model_name=engine.provider,
            )
            db.add(task)
            db.commit()
            db.refresh(task)
            task_id = task.id
            task_session_id = session.id

            # Fire via TaskRunner
            temp = (temperature_int or 5) / 10.0
            TaskRunner.get().start_task(
                task_id=task_id,
                user_id=user_id,
                prompt=prompt,
                session_id=task_session_id,
                temperature=temp,
                max_tokens=max_tokens or 2048,
            )

            logger.info(f"Scheduled task #{schedule_id} → AITask #{task_id} started")

            # Wait for task to finish (poll, max 30 minutes)
            runner = TaskRunner.get()
            deadline = time.time() + 1800
            while time.time() < deadline:
                live = runner.get_task(task_id)
                # TaskStatus.value is a string ("done", "error", etc.)
                if not live or str(live.status.value) in ("done", "error", "cancelled"):
                    break
                time.sleep(5)

            # Read final status
            db.expire_all()
            task_final = db.query(AITask).filter(AITask.id == task_id).first()
            status = str(task_final.status) if task_final else "error"
            result = (task_final.result or "")[:2000] if task_final else ""

            self._finish_schedule(schedule_id, status, result)

        except Exception as e:
            logger.error(f"Scheduled task #{schedule_id} failed: {e}", exc_info=True)
            self._finish_schedule(schedule_id, "error", str(e)[:500])
        finally:
            db.close()

    def _finish_schedule(self, schedule_id: int, status: str, result: str):
        """Update the scheduled task record after execution."""
        from db.psql.session import SessionLocal
        from db.psql.models.scheduled_task import ScheduledTask

        db = SessionLocal()
        try:
            db.query(ScheduledTask).filter(ScheduledTask.id == schedule_id).update({
                "last_status": status,
                "last_result": result[:5000] if result else "",
                "run_count": ScheduledTask.run_count + 1,
            })
            db.commit()
        except Exception as e:
            logger.error(f"Failed to update scheduled task #{schedule_id}: {e}")
        finally:
            db.close()

        with self._runs_lock:
            self._running_schedule_ids.discard(schedule_id)

        logger.info(f"Scheduled task #{schedule_id} finished: {status}")

    @staticmethod
    def compute_next_run(cron_expression: str) -> datetime.datetime:
        """Compute next run time from a cron expression."""
        now = datetime.datetime.now(datetime.UTC)
        cron = croniter(cron_expression, now)
        return cron.get_next(datetime.datetime)
