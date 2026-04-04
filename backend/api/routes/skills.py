"""
Skills API — CRUD endpoints for managing Agent custom skills.
"""
import re
import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from core.skill_manager import SkillManager
from core.security import get_current_user

router = APIRouter(prefix="/skills", tags=["skills"])
logger = logging.getLogger("SkillsAPI")


class SkillCreate(BaseModel):
    name: str
    description: str
    tool_name: str
    parameters: str = ""
    code: str


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tool_name: Optional[str] = None
    parameters: Optional[str] = None
    code: Optional[str] = None
    enabled: Optional[bool] = None


class SkillTest(BaseModel):
    args: Dict[str, Any] = {}


@router.get("")
def list_skills(user_id: int = Depends(get_current_user)):
    """List all registered skills."""
    skills = SkillManager.get(user_id).list_skills()
    return {"skills": skills, "total": len(skills)}


# ── Built-in Tools Listing (must be before /{skill_id}) ──────────────

_CATEGORY_ICONS = {
    "FILE": "file",
    "SEARCH": "search",
    "BROWSER": "browser",
    "DESKTOP": "desktop",
    "AI_CODING": "code",
    "MEMORY": "brain",
    "SOCIAL": "social",
    "OTHER": "other",
    "OFFICE": "office",
    "PDF": "pdf",
}


def _parse_builtin_tools() -> List[Dict[str, Any]]:
    """Parse TOOL_DEFINITIONS string into structured list of built-in tools."""
    from core.agent_tools import TOOL_DEFINITIONS
    tools = []
    for line in TOOL_DEFINITIONS.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        match = re.match(r"^([A-Z_]+):\s*(.+)$", line)
        if not match:
            continue
        category = match.group(1)
        rest = match.group(2)
        parts = rest.split("|")
        for part in parts:
            part = part.strip()
            desc = ""
            if "\u2192" in part:
                part, desc = part.split("\u2192", 1)
                part = part.strip()
                desc = desc.strip()
            tmatch = re.match(r"^(\w+)\{([^}]*)\}(.*)$", part)
            if tmatch:
                tool_name = tmatch.group(1)
                params = tmatch.group(2)
                extra = tmatch.group(3).strip()
                if extra and not desc:
                    desc = extra
                tools.append({
                    "tool_name": tool_name,
                    "parameters": params,
                    "category": category,
                    "description": desc,
                    "icon": _CATEGORY_ICONS.get(category, "other"),
                    "type": "builtin",
                })
            elif part:
                name_only = re.match(r"^(\w+)", part)
                if name_only:
                    tools.append({
                        "tool_name": name_only.group(1),
                        "parameters": "",
                        "category": category,
                        "description": desc,
                        "icon": _CATEGORY_ICONS.get(category, "other"),
                        "type": "builtin",
                    })
    return tools


@router.get("/builtin/list")
def list_builtin_tools():
    """List all built-in agent tools parsed from TOOL_DEFINITIONS."""
    tools = _parse_builtin_tools()
    categories = {}
    for t in tools:
        cat = t["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(t)
    return {"tools": tools, "categories": categories, "total": len(tools)}


@router.get("/{skill_id}")
def get_skill(skill_id: str, user_id: int = Depends(get_current_user)):
    """Get a single skill with its code."""
    skill = SkillManager.get(user_id).get_skill(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill


@router.post("")
def create_skill(body: SkillCreate, user_id: int = Depends(get_current_user)):
    """Create a new skill."""
    try:
        skill = SkillManager.get(user_id).create_skill(
            name=body.name,
            description=body.description,
            tool_name=body.tool_name,
            parameters=body.parameters,
            code=body.code,
        )
        return {"message": f"Skill '{body.name}' created", "skill": skill}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{skill_id}")
def update_skill(skill_id: str, body: SkillUpdate, user_id: int = Depends(get_current_user)):
    """Update an existing skill."""
    try:
        skill = SkillManager.get(user_id).update_skill(
            skill_id=skill_id,
            name=body.name,
            description=body.description,
            tool_name=body.tool_name,
            parameters=body.parameters,
            code=body.code,
            enabled=body.enabled,
        )
        return {"message": "Skill updated", "skill": skill}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{skill_id}")
def delete_skill(skill_id: str, user_id: int = Depends(get_current_user)):
    """Delete a skill."""
    success = SkillManager.get(user_id).delete_skill(skill_id)
    if not success:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"message": "Skill deleted"}


@router.post("/{skill_id}/reload")
def reload_skill(skill_id: str, user_id: int = Depends(get_current_user)):
    """Reload a skill (re-import its Python code)."""
    try:
        skill = SkillManager.get(user_id).reload_skill(skill_id)
        return {"message": "Skill reloaded", "skill": skill}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{skill_id}/test")
def test_skill(skill_id: str, body: SkillTest, user_id: int = Depends(get_current_user)):
    """Test a skill with sample args."""
    result = SkillManager.get(user_id).test_skill(skill_id, body.args)
    return result


@router.post("/{skill_id}/toggle")
def toggle_skill(skill_id: str, user_id: int = Depends(get_current_user)):
    """Toggle a skill's enabled state."""
    skill = SkillManager.get(user_id).get_skill(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    new_enabled = not skill.get("enabled", True)
    updated = SkillManager.get(user_id).update_skill(skill_id, enabled=new_enabled)
    return {"message": f"Skill {'enabled' if new_enabled else 'disabled'}", "skill": updated}
