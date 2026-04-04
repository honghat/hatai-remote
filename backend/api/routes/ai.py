"""
AI Chat Routes with SSE Streaming
- GET  /ai/status           - Model status
- POST /ai/chat/stream      - Stream response via SSE
- POST /ai/chat             - Non-streaming response
- GET  /ai/sessions         - List chat sessions
- POST /ai/sessions         - Create session
- GET  /ai/sessions/{id}    - Get session messages
- DELETE /ai/sessions/{id}  - Delete session
"""
import asyncio
import json
from typing import AsyncGenerator, List, Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
import os
import uuid
import shutil
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from core.llm_engine import LLMEngine
from core.memory import MemoryManager
from core.security import get_current_user
from crud.chat_service import ChatService
from db.psql.session import get_db
from schemas.chat import (
    ChatRequest,
    ChatSessionCreate,
    ChatSessionOut,
    ChatMessageOut,
)

router = APIRouter()


@router.get("/logs", tags=["System"])
def get_system_logs(user_id: int = Depends(get_current_user)):
    """Read last N lines from both system.log and code_server.log for unified monitoring."""
    import os
    
    logs = []
    
    def read_file(path, label):
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.readlines()[-100:] # last 100 per file
                    processed = []
                    for line in content:
                        line = line.strip()
                        if not line: continue
                        # If line starts with timestamp (YYYY-MM-DD), insert label after it
                        if len(line) > 19 and line[4] == '-' and line[7] == '-' and line[10] == ' ':
                            ts = line[:19]
                            rest = line[19:].strip()
                            processed.append(f"{ts} [{label}] {rest}")
                        else:
                            processed.append(f"[UNKNOWN] [{label}] {line}")
                    return processed
            except Exception as e:
                return [f"[ERROR] Failed to read {label} logs: {e}"]
        return []

    system_logs = read_file(os.path.join("data", "system.log"), "Main")
    code_logs = read_file(os.path.join("data", "code_server.log"), "Code")
    
    # Merge and sort by timestamp
    all_logs = system_logs + code_logs
    all_logs.sort() # Standard sort works because YYYY-MM-DD is at the start
        
    return {"logs": all_logs[-250:]}


def _build_chat_system_prompt(base_prompt: str, user_message: str) -> str:
    """Enrich the base system prompt with memory context (soul, preferences, RAG).

    This ensures even simple chat mode benefits from the agent's memory systems,
    without the full tool definitions that the agent executor adds.
    """
    try:
        memory = MemoryManager.get()

        parts = [base_prompt]

        # Soul (personality/directives)
        soul = memory.get_soul()
        if soul:
            parts.append(f"\n## Chỉ thị cốt lõi:\n{soul}")

        # User preferences
        prefs = memory.get_preferences()
        if prefs:
            prefs_list = [f"- {k}: {v}" for k, v in prefs.items() if not k.startswith("_")]
            if prefs_list:
                parts.append("\n## Sở thích người dùng:\n" + "\n".join(prefs_list))

        # Recent episodes for continuity
        episodes = memory.get_recent_episodes(3)
        if episodes:
            ep_list = [f"- {e['date']}: {e['summary']}" for e in episodes]
            parts.append("\n## Cuộc trò chuyện gần đây:\n" + "\n".join(ep_list))

        # RAG knowledge relevant to this query
        if user_message:
            relevant = memory.query_all_knowledge(user_message, n_results=5)
            if relevant:
                rag_list = [f"- [{r['topic']}]: {r['content']}" for r in relevant]
                parts.append("\n## Kiến thức liên quan:\n" + "\n".join(rag_list))

        return "\n".join(parts)
    except Exception:
        # Fallback to base prompt if memory systems fail
        return base_prompt


@router.post("/upload", tags=["AI"])
async def upload_media(file: UploadFile = File(...), user_id: int = Depends(get_current_user)):
    """Upload media file for AI chat context."""
    ext = os.path.splitext(file.filename)[1]
    unique_name = f"{uuid.uuid4()}{ext}"
    os.makedirs("uploads", exist_ok=True)
    file_path = os.path.join("uploads", unique_name)
    
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # In a real setup, this might be a full URL, but here relative is okay for proxying
        return {
            "name": file.filename,
            "url": f"/uploads/{unique_name}",
            "type": file.content_type
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status", tags=["AI"])
def get_status():
    engine = LLMEngine.get()
    return engine.status


@router.get("/provider", tags=["AI"])
def get_provider():
    """Get current LLM provider info."""
    engine = LLMEngine.get()
    return {
        "provider": engine.provider,
        "ready": engine.is_ready,
        "available": ["local", "gemini", "ollama", "openai", "deepseek"],
    }


@router.get("/settings", tags=["AI"])
def get_settings():
    from core.config import GEMINI_API_KEY, OLLAMA_URL, OPENAI_API_BASE, OPENAI_API_KEY, DEEPSEEK_API_KEY
    import re
    # Mask API keys for security
    def mask(k):
        if not k: return ""
        if len(k) < 10: return "***"
        return k[:4] + "*" * (len(k) - 8) + k[-4:]
        
    return {
        "gemini_api_key": mask(GEMINI_API_KEY),
        "ollama_url": OLLAMA_URL,
        "openai_api_base": OPENAI_API_BASE,
        "openai_api_key": mask(OPENAI_API_KEY),
        "deepseek_api_key": mask(DEEPSEEK_API_KEY)
    }


@router.post("/settings", tags=["AI"])
def update_settings(data: dict):
    from core.config import BACKEND_DIR
    env_file = os.path.join(BACKEND_DIR, ".env")
    
    gemini_key = data.get("gemini_api_key")
    gemini_model = data.get("gemini_model")
    ollama_url = data.get("ollama_url")
    ollama_model = data.get("ollama_model")
    openai_api_base = data.get("openai_api_base")
    openai_api_key = data.get("openai_api_key")
    openai_model = data.get("openai_model")
    deepseek_api_key = data.get("deepseek_api_key")
    deepseek_model = data.get("deepseek_model")
    
    if os.path.exists(env_file):
        with open(env_file, "r") as f:
            lines = f.readlines()
            
        settings_to_update = {}
        if gemini_key and not gemini_key.startswith("***") and "*" not in gemini_key:
            settings_to_update["GEMINI_API_KEY"] = gemini_key
        
        if gemini_model:
            settings_to_update["GEMINI_MODEL"] = gemini_model

        if ollama_url:
            settings_to_update["OLLAMA_URL"] = ollama_url
        
        if ollama_model:
            settings_to_update["OLLAMA_MODEL"] = ollama_model
            
        if openai_api_base:
            settings_to_update["OPENAI_API_BASE"] = openai_api_base
            
        if openai_api_key and not openai_api_key.startswith("***") and "*" not in openai_api_key:
            settings_to_update["OPENAI_API_KEY"] = openai_api_key

        if openai_model:
            settings_to_update["OPENAI_MODEL"] = openai_model
            
        if deepseek_api_key and not deepseek_api_key.startswith("***") and "*" not in deepseek_api_key:
            settings_to_update["DEEPSEEK_API_KEY"] = deepseek_api_key
            
        if deepseek_model:
            settings_to_update["DEEPSEEK_MODEL"] = deepseek_model
            
        new_lines = []
        updated_keys = set()
        
        for line in lines:
            line = line.strip()
            if not line or line.startswith("#"):
                new_lines.append(line + "\n")
                continue
                
            line_key = line.split("=")[0].strip() if "=" in line else ""
            if line_key in settings_to_update:
                new_lines.append(f'{line_key}="{settings_to_update[line_key]}"\n')
                updated_keys.add(line_key)
            else:
                new_lines.append(line + "\n")
                
        for key, val in settings_to_update.items():
            if key not in updated_keys:
                new_lines.append(f'{key}="{val}"\n')
                
        with open(env_file, "w") as f:
            f.writelines(new_lines)
            
        import core.config as config
        if "GEMINI_API_KEY" in settings_to_update:
            config.GEMINI_API_KEY = settings_to_update["GEMINI_API_KEY"]
        if "GEMINI_MODEL" in settings_to_update:
            config.GEMINI_MODEL = settings_to_update["GEMINI_MODEL"]
        if "OLLAMA_URL" in settings_to_update:
            config.OLLAMA_URL = settings_to_update["OLLAMA_URL"]
        if "OLLAMA_MODEL" in settings_to_update:
            config.OLLAMA_MODEL = settings_to_update["OLLAMA_MODEL"]
        if "OPENAI_API_BASE" in settings_to_update:
            config.OPENAI_API_BASE = settings_to_update["OPENAI_API_BASE"]
        if "OPENAI_API_KEY" in settings_to_update:
            config.OPENAI_API_KEY = settings_to_update["OPENAI_API_KEY"]
        if "OPENAI_MODEL" in settings_to_update:
            config.OPENAI_MODEL = settings_to_update["OPENAI_MODEL"]
        if "DEEPSEEK_API_KEY" in settings_to_update:
            config.DEEPSEEK_API_KEY = settings_to_update["DEEPSEEK_API_KEY"]
        if "DEEPSEEK_MODEL" in settings_to_update:
            config.DEEPSEEK_MODEL = settings_to_update["DEEPSEEK_MODEL"]
            
        engine = LLMEngine.get()
        engine.reload_provider_config()
            
        return {"message": "Settings updated", "updated": list(settings_to_update.keys())}
    return {"error": ".env file not found"}


@router.post("/provider", tags=["AI"])
def set_provider(data: dict):
    """Switch LLM provider and save as default in .env file. Body: {"provider": "local" | "gemini" | "ollama" | "openai"}"""
    provider = data.get("provider", "")
    if not provider:
        raise HTTPException(status_code=400, detail="provider is required")
    engine = LLMEngine.get()
    result = engine.set_provider(provider)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
        
    # Save to .env so it becomes the default across restarts
    import os
    env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
    if os.path.exists(env_file):
        with open(env_file, "r") as f:
            lines = f.readlines()
            
        new_lines = []
        updated = False
        for line in lines:
            if line.startswith("LLM_PROVIDER="):
                new_lines.append(f'LLM_PROVIDER="{provider}"\n')
                updated = True
            else:
                new_lines.append(line)
                
        if not updated:
            if new_lines and not new_lines[-1].endswith("\n"):
                new_lines[-1] += "\n"
            new_lines.append(f'LLM_PROVIDER="{provider}"\n')
            
        with open(env_file, "w") as f:
            f.writelines(new_lines)
            
    return result


@router.post("/load", tags=["AI"])
def load_model():
    """Manually trigger model load (usually done at startup)."""
    engine = LLMEngine.get()
    if not engine._local_loaded and not engine._local_loading:
        import threading
        threading.Thread(target=engine.load, daemon=True).start()
        return {"message": "Model loading started"}
    return {"message": "Model already loaded or loading", "status": engine.status}


import base64
import mimetypes

@router.post("/chat/stream", tags=["AI"])
async def chat_stream(
    body: ChatRequest,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Stream AI response via Server-Sent Events.
    Creates or continues a chat session.
    """
    engine = LLMEngine.get()
    if not engine.is_ready:
        raise HTTPException(status_code=503, detail="Model chưa sẵn sàng. Vui lòng đợi.")

    svc = ChatService(db)

    # Create session if needed
    if body.session_id:
        session = svc.get_session(body.session_id, user_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session không tồn tại")
    else:
        session = svc.create_session(user_id, ChatSessionCreate(title=body.message[:50]))

    # Build message history with memory-enriched system prompt
    history = svc.get_messages(session.id)
    system_prompt = _build_chat_system_prompt(body.system_prompt, body.message)
    messages = [{"role": "system", "content": system_prompt}]
    for m in history:
        messages.append({"role": m.role, "content": m.content})
    
    # User message with Vision (if any)
    user_content = [{"type": "text", "text": body.message}]
    if body.attachments:
        for att in body.attachments:
            if "url" in att:
                # Resolve local path from relative URL
                file_rel = att["url"].lstrip("/") # uploads/uuid.png
                if os.path.exists(file_rel):
                    with open(file_rel, "rb") as f:
                        encoded = base64.b64encode(f.read()).decode("utf-8")
                    mime = mimetypes.guess_type(file_rel)[0] or "image/jpeg"
                    if mime.startswith("image"):
                        user_content.append({
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{encoded}"}
                        })

    messages.append({"role": "user", "content": user_content})

    # Save user message with attachments
    import json
    att_json = json.dumps(body.attachments) if body.attachments else None
    svc.add_message(session.id, "user", body.message, attachments=att_json)

    async def event_generator() -> AsyncGenerator[str, None]:
        # Send session ID first
        yield f"data: {json.dumps({'type': 'session', 'session_id': session.id})}\n\n"

        full_response = []
        loop = asyncio.get_event_loop()

        def run_inference():
            return list(
                engine.chat_stream(
                    messages=messages,
                    max_tokens=body.max_tokens,
                    temperature=body.temperature,
                )
            )

        try:
            tokens = await loop.run_in_executor(None, run_inference)
            for token in tokens:
                full_response.append(token)
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
                await asyncio.sleep(0)
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            return

        # Save assistant message
        assistant_text = "".join(full_response)
        svc.add_message(session.id, "assistant", assistant_text)

        # Update session title if it's new
        if not body.session_id:
            title = body.message[:60]
            svc.update_session_title(session.id, title)

        yield f"data: {json.dumps({'type': 'done', 'session_id': session.id})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chat", tags=["AI"])
async def chat_sync(
    body: ChatRequest,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Non-streaming chat (returns full response at once)."""
    engine = LLMEngine.get()
    if not engine.is_ready:
        raise HTTPException(status_code=503, detail="Model chưa sẵn sàng")

    svc = ChatService(db)
    if body.session_id:
        session = svc.get_session(body.session_id, user_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session không tồn tại")
    else:
        session = svc.create_session(user_id, ChatSessionCreate(title=body.message[:50]))

    history = svc.get_messages(session.id)
    system_prompt = _build_chat_system_prompt(body.system_prompt, body.message)
    messages = [{"role": "system", "content": system_prompt}]
    for m in history:
        messages.append({"role": m.role, "content": m.content})
    # User message with Vision (if any)
    user_content = [{"type": "text", "text": body.message}]
    if body.attachments:
        import base64, mimetypes
        for att in body.attachments:
            if "url" in att:
                file_rel = att["url"].lstrip("/")
                if os.path.exists(file_rel):
                    with open(file_rel, "rb") as f:
                        encoded = base64.b64encode(f.read()).decode("utf-8")
                    mime = mimetypes.guess_type(file_rel)[0] or "image/jpeg"
                    if mime.startswith("image"):
                        user_content.append({
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{encoded}"}
                        })

    messages.append({"role": "user", "content": user_content})

    import json
    att_json = json.dumps(body.attachments) if body.attachments else None
    svc.add_message(session.id, "user", body.message, attachments=att_json)

    import asyncio, functools
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        functools.partial(
            engine.chat_sync,
            messages=messages,
            max_tokens=body.max_tokens,
            temperature=body.temperature,
        ),
    )
    svc.add_message(session.id, "assistant", result)
    return {"session_id": session.id, "response": result}


# ── Session Management ─────────────────────────────────────────────────────────

@router.get("/sessions", response_model=List[ChatSessionOut], tags=["AI"])
def list_sessions(user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    svc = ChatService(db)
    return svc.get_sessions(user_id)


@router.post("/sessions", response_model=ChatSessionOut, tags=["AI"])
def create_session(
    data: ChatSessionCreate,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = ChatService(db)
    return svc.create_session(user_id, data)


@router.get("/sessions/{session_id}/messages", response_model=List[ChatMessageOut], tags=["AI"])
def get_messages(
    session_id: int,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = ChatService(db)
    session = svc.get_session(session_id, user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session không tồn tại")
    return svc.get_messages(session_id)


@router.delete("/sessions/{session_id}", tags=["AI"])
def delete_session(
    session_id: int,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = ChatService(db)
    ok = svc.delete_session(session_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Session không tồn tại")
        
    # Also delete the associated RAG collection
    try:
        from core.rag_engine import RAGEngine
        topic = f"session_{session_id}"
        RAGEngine.get().delete_topic(topic)
    except Exception:
        pass # It's okay if it didn't exist
        
    return {"message": "Đã xóa session và dữ liệu RAG liên quan."}


@router.put("/sessions/{session_id}", tags=["AI"])
def update_session(
    session_id: int,
    data: ChatSessionCreate,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = ChatService(db)
    session = svc.get_session(session_id, user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session không tồn tại")
    svc.update_session_title(session_id, data.title)
    return {"message": "Đã cập nhật tiêu đề", "title": data.title}


# ── AI Providers Database CRUD ───────────────────────────────────────────────
from db.psql.models.ai_provider import AIProvider

@router.get("/providers", tags=["AI"])
def list_providers(db: Session = Depends(get_db), user_id: int = Depends(get_current_user)):
    """List all AI providers stored in DB."""
    return db.query(AIProvider).order_by(AIProvider.id.asc()).all()

@router.post("/providers", tags=["AI"])
def create_provider(data: dict, db: Session = Depends(get_db), user_id: int = Depends(get_current_user)):
    """Create a new AI provider entry."""
    new_p = AIProvider(
        name=data.get("name", "New Model"),
        provider_type=data.get("provider_type", "openai"),
        model_name=data.get("model_name", ""),
        api_base=data.get("api_base"),
        api_key=data.get("api_key"),
        is_active=False
    )
    db.add(new_p)
    db.commit()
    db.refresh(new_p)
    return new_p

@router.put("/providers/{provider_id}", tags=["AI"])
def update_provider_db(provider_id: int, data: dict, db: Session = Depends(get_db), user_id: int = Depends(get_current_user)):
    """Update an existing AI provider."""
    p = db.query(AIProvider).filter(AIProvider.id == provider_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    
    if "name" in data: p.name = data["name"]
    if "provider_type" in data: p.provider_type = data["provider_type"]
    if "model_name" in data: p.model_name = data["model_name"]
    if "api_base" in data: p.api_base = data["api_base"]
    if "api_key" in data and not data["api_key"].startswith("***"):
        p.api_key = data["api_key"]
    
    db.commit()
    return p

@router.delete("/providers/{provider_id}", tags=["AI"])
def delete_provider(provider_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user)):
    """Delete an AI provider."""
    p = db.query(AIProvider).filter(AIProvider.id == provider_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    db.delete(p)
    db.commit()
    return {"message": "Model connection removed from workspace."}

@router.post("/providers/{provider_id}/activate", tags=["AI"])
def activate_provider_db(provider_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user)):
    """Activate this specific provider instance."""
    # Deactivate all others
    db.query(AIProvider).update({AIProvider.is_active: False})
    
    # Activate this one
    p = db.query(AIProvider).filter(AIProvider.id == provider_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    
    p.is_active = True
    db.commit()
    
    # Apply to Engine immediately
    engine = LLMEngine.get()
    engine.load_from_db()
    
    return {"message": f"Deployed Linking to {p.name}", "provider": p.provider_type}

@router.post("/providers/seed", tags=["AI"])
def seed_providers_from_env(db: Session = Depends(get_db)):
    """Trigger manual seeding from .env config."""
    from crud.admin_service import AdminService
    svc = AdminService(db)
    svc.seed_ai_providers()
    return {"message": "AI providers seeded from legacy .env config."}
