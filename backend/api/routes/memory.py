"""
Memory API v3 — Quản lý Unified Memory của Agent qua MemoryManager.
"""
import os
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel

from core.memory import MemoryManager
from core.security import get_current_user
from fastapi import APIRouter, HTTPException, Body, Depends

router = APIRouter(prefix="/memory", tags=["memory"])
logger = logging.getLogger("MemoryAPI")

class MemoryUpdate(BaseModel):
    content: str

class PreferenceUpdate(BaseModel):
    key: str
    value: Any

class KnowledgeAdd(BaseModel):
    topic: str
    content: str

class TopicDelete(BaseModel):
    topic: str

class PreferenceDelete(BaseModel):
    key: str

# ── Soul Memory ──────────────────────────────────────────────────

@router.get("/soul")
def get_soul_memory(user_id: int = Depends(get_current_user)):
    return {"content": MemoryManager.get(user_id).get_soul()}

@router.post("/soul")
def update_soul_memory(body: MemoryUpdate, user_id: int = Depends(get_current_user)):
    MemoryManager.get(user_id).update_soul(body.content)
    return {"message": "Soul memory updated"}

@router.get("/scratchpad")
def get_scratchpad(user_id: int = Depends(get_current_user)):
    content = MemoryManager.get(user_id).get_scratchpad()
    return {"content": content, "size": len(content)}

@router.post("/scratchpad")
def update_scratchpad(body: MemoryUpdate, user_id: int = Depends(get_current_user)):
    MemoryManager.get(user_id).write_scratchpad(body.content, mode="overwrite")
    return {"message": "Scratchpad updated"}

@router.delete("/scratchpad")
def clear_scratchpad(user_id: int = Depends(get_current_user)):
    MemoryManager.get(user_id).clear_scratchpad()
    return {"message": "Scratchpad cleared"}

# ── Knowledge Base (RAG) ─────────────────────────────────────────

@router.get("/knowledge")
def list_knowledge(user_id: int = Depends(get_current_user)):
    """List all knowledge topics with entry counts."""
    memory = MemoryManager.get(user_id)
    topics = memory.list_topics()
    result = []
    for t in topics:
        try:
            col = memory.rag._get_collection(t, user_id=user_id)
            count = col.count() if col else 0
        except Exception:
            count = 0
        result.append({"topic": t, "entries": count})
    return {"topics": result, "total": len(result)}

@router.post("/knowledge")
def add_knowledge(body: KnowledgeAdd, user_id: int = Depends(get_current_user)):
    try:
        MemoryManager.get(user_id).add_knowledge(body.topic, body.content, source="user_teach")
        return {"message": f"Added to knowledge topic '{body.topic}'"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/knowledge/{topic}")
def query_knowledge(topic: str, q: Optional[str] = None, user_id: int = Depends(get_current_user)):
    memory = MemoryManager.get(user_id)
    try:
        if q:
            return memory.query_knowledge(topic, q, n_results=10)
        else:
            col = memory.rag._get_collection(topic, user_id=user_id)
            if not col:
                return {"topic": topic, "entries": [], "count": 0}
            data = col.get(limit=50)
            entries = []
            for i, doc in enumerate(data.get("documents", [])):
                entries.append({
                    "id": data["ids"][i] if "ids" in data else str(i),
                    "content": doc,
                    "metadata": data["metadatas"][i] if "metadatas" in data else {},
                })
            return {"topic": topic, "entries": entries, "count": col.count()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@router.post("/knowledge/remove")
def delete_knowledge_topic(body: TopicDelete, user_id: int = Depends(get_current_user)):
    logger.info(f"🗑️ User {user_id} deleting knowledge topic via POST: '{body.topic}'")
    MemoryManager.get(user_id).delete_topic(body.topic)
    return {"message": f"Deleted topic '{body.topic}'"}

@router.delete("/knowledge/{topic}/{entry_id}")
def delete_knowledge_entry(topic: str, entry_id: str):
    memory = MemoryManager.get()
    try:
        col = memory.rag._get_collection(topic)
        if col:
            col.delete(ids=[entry_id])
            return {"message": "Entry deleted"}
        raise HTTPException(status_code=404, detail="Topic not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── Preferences (v3 New) ────────────────────────────────────────

@router.get("/preferences")
def get_preferences(user_id: int = Depends(get_current_user)):
    return MemoryManager.get(user_id).get_preferences()

@router.post("/preferences")
def update_preference(body: PreferenceUpdate, user_id: int = Depends(get_current_user)):
    MemoryManager.get(user_id).update_preferences(body.key, body.value)
    return {"message": f"Preference '{body.key}' updated"}

@router.post("/preferences/remove")
def delete_preference(body: PreferenceDelete, user_id: int = Depends(get_current_user)):
    key = body.key
    logger.info(f"🗑️ User {user_id} deleting preference via POST: '{key}'")
    memory = MemoryManager.get(user_id)
    prefs = memory.get_preferences()
    if key in prefs:
        del prefs[key]
        memory.set_preferences(prefs)
        return {"message": f"Preference '{key}' deleted"}
    raise HTTPException(status_code=404, detail="Preference not found")

# ── Brain Overview ───────────────────────────────────────────────

@router.get("/overview")
def brain_overview(user_id: int = Depends(get_current_user)):
    """Complete overview of everything the agent knows and has learned."""
    return MemoryManager.get(user_id).get_brain_overview()

# ── Teach Agent ──────────────────────────────────────────────────

@router.post("/teach")
def teach_agent(category: str = Body(...), content: str = Body(...), topic: Optional[str] = Body(None), user_id: int = Depends(get_current_user)):
    """Unified endpoint to teach the agent."""
    memory = MemoryManager.get(user_id)
    if category == "soul":
        current = memory.get_soul()
        memory.update_soul(current.rstrip() + "\n\n" + content)
        return {"message": "Added to soul memory"}
    elif category == "knowledge":
        t = topic or "general"
        memory.add_knowledge(t, content, source="user_teach")
        return {"message": f"Added to knowledge base under '{t}'"}
    elif category == "preference":
        if ":" in content:
            k, v = content.split(":", 1)
            memory.update_preferences(k.strip(), v.strip())
        else:
            memory.update_preferences("user_note", content)
        return {"message": "Preference updated"}
    
    raise HTTPException(status_code=400, detail=f"Unknown category: {category}")

@router.delete("/wipe", tags=["memory"])
def wipe_all_memory(user_id: int = Depends(get_current_user)):
    """Wipe all learned memory for authenticated user."""
    try:
        MemoryManager.get(user_id).clear_all_memory()
        return {"message": "Dữ liệu trí nhớ cá nhân của bạn đã được xóa sạch."}
    except Exception as e:
        logger.error(f"Error wiping memory for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
