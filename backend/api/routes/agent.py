"""
AI Agent Routes — autonomous agent mode with tool execution
- POST /agent/run       - Run agent with streaming SSE events (legacy)
- POST /agent/stop      - Stop the currently running agent
- GET  /agent/screenshots/{filename} - Serve screenshot images
- POST /agent/daemon/start  - Start persistent daemon
- POST /agent/daemon/stop   - Stop persistent daemon
- POST /agent/daemon/send   - Send command to daemon
- POST /agent/daemon/pause  - Pause daemon
- POST /agent/daemon/resume - Resume daemon
- GET  /agent/daemon/status - Get daemon status
- WS   /agent/daemon/ws    - Bidirectional WebSocket for persistent agent
- WS   /agent/ws           - Chrome Extension WebSocket (legacy)
"""
import asyncio
import json
import os
import threading
from typing import AsyncGenerator, Optional, Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

# Mapping for legacy Chrome Extension broadcast: {ws: Lock}
ACTIVE_WS: Dict[WebSocket, asyncio.Lock] = {}
CURRENT_LOG_BUFFER = []

# Cancel flag for currently running agent
_agent_cancel_event = threading.Event()

from core.agent_executor import run_agent
from core.agent_daemon import AgentDaemon, DaemonCommand
from core.agent_tools import SCREENSHOT_DIR
from core.llm_engine import LLMEngine
from core.security import get_current_user
from crud.chat_service import ChatService
from db.psql.session import get_db
from schemas.chat import ChatRequest, ChatSessionCreate

router = APIRouter()


# ── Daemon Schemas ────────────────────────────────────────────────────────────

class DaemonSendRequest(BaseModel):
    message: str
    session_id: Optional[int] = None
    max_tokens: int = 8192
    temperature: float = 0.5
    attachments: Optional[List[dict]] = None


# ── Daemon Endpoints ──────────────────────────────────────────────────────────

@router.post("/daemon/start", tags=["Agent Daemon"])
async def daemon_start():
    """Start the persistent agent daemon."""
    daemon = AgentDaemon.get()
    loop = asyncio.get_event_loop()
    daemon.start(event_loop=loop)
    return {"message": "Agent daemon started", "status": daemon.get_status()}


@router.post("/daemon/stop", tags=["Agent Daemon"])
async def daemon_stop():
    """Stop the persistent agent daemon."""
    daemon = AgentDaemon.get()
    daemon.stop()
    return {"message": "Agent daemon stopped"}


@router.post("/daemon/send", tags=["Agent Daemon"])
async def daemon_send(
    body: DaemonSendRequest,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send a command/task to the persistent daemon."""
    daemon = AgentDaemon.get()
    if daemon.state.value == "stopped":
        raise HTTPException(status_code=400, detail="Daemon chưa khởi động. Gọi /agent/daemon/start trước.")

    # Create session if not provided
    session_id = body.session_id
    if not session_id:
        svc = ChatService(db)
        session = svc.create_session(
            user_id,
            ChatSessionCreate(title=f"🤖 {body.message[:45]}")
        )
        session_id = session.id

    cmd = DaemonCommand(
        type="task",
        message=body.message,
        session_id=session_id,
        max_tokens=body.max_tokens,
        temperature=body.temperature,
        attachments=body.attachments,
    )
    daemon.send_command(cmd)
    return {
        "message": "Command sent to daemon",
        "session_id": session_id,
        "queue_size": daemon.get_queue_size(),
        "state": daemon.state.value,
    }


@router.post("/daemon/pause", tags=["Agent Daemon"])
async def daemon_pause():
    """Pause the daemon (finishes current step, then waits)."""
    daemon = AgentDaemon.get()
    daemon.pause()
    return {"message": "Daemon paused", "state": daemon.state.value}


@router.post("/daemon/resume", tags=["Agent Daemon"])
async def daemon_resume():
    """Resume the daemon from paused state."""
    daemon = AgentDaemon.get()
    daemon.resume()
    return {"message": "Daemon resumed", "state": daemon.state.value}


@router.post("/daemon/cancel", tags=["Agent Daemon"])
async def daemon_cancel():
    """Cancel the current task (daemon stays alive)."""
    daemon = AgentDaemon.get()
    daemon.cancel_current()
    return {"message": "Current task cancelled", "state": daemon.state.value}


@router.get("/daemon/status", tags=["Agent Daemon"])
async def daemon_status():
    """Get daemon status."""
    daemon = AgentDaemon.get()
    return daemon.get_status()


@router.websocket("/daemon/ws")
async def daemon_websocket(websocket: WebSocket):
    """
    Bidirectional WebSocket for persistent agent daemon.

    Client -> Server messages (JSON):
      {"type": "task", "message": "...", "session_id": 123}
      {"type": "pause"}
      {"type": "resume"}
      {"type": "cancel"}
      {"type": "status"}

    Server -> Client messages (JSON):
      {"type": "heartbeat", "state": "idle", ...}
      {"type": "daemon_status", "state": "running", ...}
      {"type": "text", "content": "..."}
      {"type": "tool_call", "tool": "...", "args": {...}}
      {"type": "tool_result", "tool": "...", "result": {...}}
      {"type": "thinking_token", "content": "..."}
      {"type": "screenshot", "url": "..."}
      {"type": "done"}
      {"type": "error", "content": "..."}
    """
    await websocket.accept()

    # Authenticate via query param: ws://host/agent/daemon/ws?token=xxx
    user_id = None
    token = websocket.query_params.get("token")
    if token:
        try:
            from jose import jwt, JWTError
            from core.config import SECRET_KEY, ALGORITHM
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = int(payload.get("sub", 0)) or None
        except Exception:
            pass

    daemon = AgentDaemon.get()

    # Auto-start daemon if not running
    if daemon.state.value == "stopped":
        loop = asyncio.get_event_loop()
        daemon.start(event_loop=loop)

    try:
        # Register this WebSocket for broadcasts
        daemon.register_ws(websocket)

        # Send current status immediately
        await websocket.send_json({
            "type": "daemon_status",
            "state": daemon.state.value,
            **daemon.get_status(),
        })

        # Send recent event buffer for context
        for ev in daemon.get_event_buffer():
            await websocket.send_json(ev)

        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "content": "Invalid JSON"})
                continue

            msg_type = data.get("type", "")

            if msg_type == "task":
                message = data.get("message", "").strip()
                if not message:
                    await websocket.send_json({"type": "error", "content": "Message is required"})
                    continue

                cmd = DaemonCommand(
                    type="task",
                    message=message,
                    session_id=data.get("session_id"),
                    user_id=user_id,
                    max_tokens=data.get("max_tokens", 8192),
                    temperature=data.get("temperature", 0.5),
                )
                daemon.send_command(cmd)
                await websocket.send_json({
                    "type": "ack",
                    "message": f"Task queued: {message[:80]}",
                    "queue_size": daemon.get_queue_size(),
                })

            elif msg_type == "pause":
                daemon.pause()

            elif msg_type == "resume":
                daemon.resume()

            elif msg_type == "inject":
                inject_msg = data.get("message", "").strip()
                if not inject_msg:
                    await websocket.send_json({"type": "error", "content": "Message is required"})
                    continue
                if daemon.state.value != "running":
                    await websocket.send_json({"type": "error", "content": "No task running to inject into"})
                    continue
                daemon.inject_message(inject_msg)

            elif msg_type == "cancel":
                daemon.cancel_current()

            elif msg_type == "stop":
                daemon.stop()
                await websocket.send_json({"type": "daemon_status", "state": "stopped"})

            elif msg_type == "status":
                await websocket.send_json({
                    "type": "daemon_status",
                    **daemon.get_status(),
                })

            else:
                await websocket.send_json({
                    "type": "error",
                    "content": f"Unknown command type: {msg_type}",
                })

    except WebSocketDisconnect:
        daemon.unregister_ws(websocket)
    except Exception as e:
        daemon.unregister_ws(websocket)
        try:
            await websocket.close()
        except Exception:
            pass


# ── Legacy Endpoints (kept for backward compatibility) ────────────────────────

@router.post("/run", tags=["Agent"])
async def agent_run(
    body: ChatRequest,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Run the AI agent with tool execution (legacy SSE mode).
    Streams SSE events for each step: thinking, tool_call, tool_result, screenshot, text, done.
    """
    engine = LLMEngine.get()
    if not engine.is_ready:
        provider = engine.provider
        raise HTTPException(
            status_code=503,
            detail=f"LLM ({provider}) chưa sẵn sàng. Kiểm tra /ai/status",
        )

    svc = ChatService(db)

    # Create or get session
    if body.session_id:
        session = svc.get_session(body.session_id, user_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session không tồn tại")
    else:
        session = svc.create_session(
            user_id,
            ChatSessionCreate(title=f"🤖 {body.message[:45]}")
        )

    # Build history from session
    history_msgs = svc.get_messages(session.id)
    history = []
    for m in history_msgs[-100:]:
        history.append({"role": m.role, "content": m.content})

    # Save user message with attachments
    att_json = json.dumps(body.attachments) if body.attachments else None
    svc.add_message(session.id, "user", body.message, attachments=att_json)

    async def event_generator() -> AsyncGenerator[str, None]:
        yield f"data: {json.dumps({'type': 'session', 'session_id': session.id})}\n\n"

        # Reset cancel flag for new run
        _agent_cancel_event.clear()

        loop = asyncio.get_event_loop()
        full_response_parts = []

        queue = asyncio.Queue()

        def agent_runner():
            try:
                from core.agent_executor import run_agent, stringify_agent_event
                for event in run_agent(
                    user_message=body.message,
                    history=history,
                    max_tokens=body.max_tokens or 8192,
                    temperature=body.temperature or 0.5,
                    cancel_event=_agent_cancel_event,
                    session_id=session.id,
                ):
                    if _agent_cancel_event.is_set():
                        break
                    
                    if event.get("type") != "thinking_token":
                        full_response_parts.append(stringify_agent_event(event))
                    loop.call_soon_threadsafe(queue.put_nowait, event)
            except Exception as e:
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "content": str(e)})
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None) # EOF

        threading.Thread(target=agent_runner, daemon=True).start()

        try:
            while True:
                event = await queue.get()
                if event is None:
                    break

                if not isinstance(event, dict):
                    continue

                # Don't send huge base64 screenshots via SSE text (send path instead)
                if event.get("type") == "screenshot":
                    path = event.get("path", "")
                    filename = os.path.basename(path) if path else ""
                    if filename:
                        sse_event = {
                            "type": "screenshot",
                            "path": path,
                            "url": f"/agent/screenshots/{filename}",
                        }
                        full_response_parts.append(f"\n📸 Screenshot: {path}\n")
                    else:
                        continue
                elif event.get("type") == "tool_result":
                    result = event.get("result", {})
                    if isinstance(result, dict):
                        result_str = json.dumps(result, ensure_ascii=False, default=str)
                        if len(result_str) > 3000:
                            result["_truncated"] = True
                            if "content" in result:
                                result["content"] = str(result["content"])[:2000] + "... [truncated]"
                            if "stdout" in result:
                                result["stdout"] = str(result["stdout"])[:2000] + "... [truncated]"
                    sse_event = event
                elif event.get("type") == "text":
                    sse_event = event
                elif event.get("type") == "thinking_token":
                    sse_event = event
                elif event.get("type") == "thinking":
                    continue
                elif event.get("type") == "tool_call":
                    sse_event = event
                else:
                    sse_event = event

                CURRENT_LOG_BUFFER.append(sse_event)
                yield f"data: {json.dumps(sse_event, ensure_ascii=False, default=str)}\n\n"

                # Broadcast to Chrome Extension via WebSocket
                if ACTIVE_WS:
                    dead_ws = []
                    for ws, lock in list(ACTIVE_WS.items()):
                        try:
                            async with lock:
                                if sse_event.get("type") == "tool_result" and "screenshot" in str(sse_event):
                                    await ws.send_json({"type": "info", "message": "Đang phân tích hình ảnh..."})
                                else:
                                    await ws.send_json(sse_event)
                        except Exception:
                            dead_ws.append(ws)
                    for d in dead_ws:
                        if d in ACTIVE_WS: del ACTIVE_WS[d]

                await asyncio.sleep(0)

        except Exception as e:
            import logging
            logger_err = logging.getLogger("HatAI-Remote.Agent")
            logger_err.error(f"Agent Run Error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

        # Save full agent response
        full_text = "".join(full_response_parts)
        if full_text.strip():
            svc.add_message(session.id, "assistant", full_text)

        # Update session title
        if not body.session_id:
            svc.update_session_title(session.id, f"🤖 {body.message[:55]}")

        yield f"data: {json.dumps({'type': 'done', 'session_id': session.id})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/stop", tags=["Agent"])
async def agent_stop():
    """Stop the currently running agent (legacy + daemon)."""
    _agent_cancel_event.set()
    # Also cancel daemon's current task if running
    daemon = AgentDaemon.get()
    if daemon.state.value == "running":
        daemon.cancel_current()
    return {"message": "Agent stop signal sent"}


@router.websocket("/ws")
async def websocket_chrome_extension(websocket: WebSocket):
    """WebSocket endpoint for HatAI Chrome Extension visually tracking the agent."""
    await websocket.accept()
    lock = asyncio.Lock()
    ACTIVE_WS[websocket] = lock

    # Gửi ngay lập tức toàn bộ log của run hiện tại cho popup vừa mở
    try:
        async with lock:
            for ev in CURRENT_LOG_BUFFER:
                if ev.get("type") == "tool_result" and "screenshot" in str(ev):
                     await websocket.send_json({"type": "info", "message": "Đang phân tích hình ảnh..."})
                else:
                     await websocket.send_json(ev)
    except Exception:
        pass

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in ACTIVE_WS:
            del ACTIVE_WS[websocket]


@router.get("/screenshots/{filename}", tags=["Agent"])
def get_screenshot(filename: str):
    """Serve a screenshot image."""
    filepath = os.path.join(SCREENSHOT_DIR, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Screenshot not found")
    media_type = "image/jpeg" if filename.endswith(".jpg") else "image/png"
    return FileResponse(filepath, media_type=media_type)
