"""
Skill Manager — Dynamic skill loading & management for the Agent.
Skills are user-defined Python tools that can be added/edited/removed at runtime.
Each skill is stored as a .py file in data/skills/ with metadata in skills_registry.json.
"""
import os
import json
import importlib.util
import logging
import traceback
import threading
from typing import Dict, Any, List, Optional
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("SkillManager")


class SkillManager:
    """Manages user-defined skills (Python tools) for the Agent."""

    _instances: Dict[int, "SkillManager"] = {}
    _lock = threading.Lock()

    @classmethod
    def get(cls, owner_id: int = 1) -> "SkillManager":
        """Get SkillManager instance for a specific user ID."""
        with cls._lock:
            if owner_id not in cls._instances:
                cls._instances[owner_id] = cls(owner_id)
        return cls._instances[owner_id]

    def __init__(self, owner_id: int):
        self.owner_id = owner_id
        self._registry: List[Dict[str, Any]] = []
        self._loaded_tools: Dict[str, callable] = {}
        self._tool_definitions: str = ""
        
        # User-specific skills directory
        from core.config import DATA_DIR
        self.skills_dir = Path(DATA_DIR) / "users" / str(owner_id) / "skills"
        self.skills_dir.mkdir(parents=True, exist_ok=True)
        self.registry_file = self.skills_dir / "skills_registry.json"
        
        self._load_registry()
        self._load_all_skills()

    # ── Registry I/O ──────────────────────────────────────────────

    def _load_registry(self):
        if self.registry_file.exists():
            try:
                with open(self.registry_file, "r", encoding="utf-8") as f:
                    self._registry = json.load(f)
            except Exception as e:
                logger.error(f"Failed to load skills registry for user {self.owner_id}: {e}")
                self._registry = []
        else:
            self._registry = []

    def _save_registry(self):
        with open(self.registry_file, "w", encoding="utf-8") as f:
            json.dump(self._registry, f, ensure_ascii=False, indent=2)

    # ── Skill Loading ─────────────────────────────────────────────

    def _load_skill(self, skill: Dict[str, Any]) -> bool:
        """Load a single skill from its Python file. Returns True on success."""
        if not skill.get("enabled", True):
            return False

        skill_file = self.skills_dir / skill["filename"]
        if not skill_file.exists():
            logger.warning(f"Skill file not found: {skill_file}")
            return False

        try:
            # Important: unique module name per user and skill
            module_name = f"user_{self.owner_id}_skill_{skill['id']}"
            spec = importlib.util.spec_from_file_location(module_name, str(skill_file))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            # The skill module must define a function called `run(args: dict) -> dict`
            if not hasattr(module, "run"):
                logger.error(f"Skill '{skill['name']}' missing run() function")
                skill["status"] = "error"
                skill["error"] = "Missing run() function"
                return False

            tool_name = skill["tool_name"]
            self._loaded_tools[tool_name] = module.run
            skill["status"] = "loaded"
            skill["error"] = None
            logger.info(f"✅ Loaded skill for user {self.owner_id}: {skill['name']} → tool '{tool_name}'")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to load skill '{skill['name']}' for user {self.owner_id}: {e}")
            skill["status"] = "error"
            skill["error"] = str(e)
            return False

    def _load_all_skills(self):
        """Load all enabled skills and rebuild tool definitions."""
        self._loaded_tools.clear()
        for skill in self._registry:
            self._load_skill(skill)
        self._rebuild_definitions()

    def _rebuild_definitions(self):
        """Rebuild the TOOL_DEFINITIONS string from loaded skills."""
        parts = []
        for skill in self._registry:
            if skill.get("status") == "loaded" and skill.get("enabled", True):
                params = skill.get("parameters", "")
                parts.append(f"{skill['tool_name']}{{{params}}}")
        if parts:
            self._tool_definitions = "SKILLS: " + " | ".join(parts)
        else:
            self._tool_definitions = ""

    # ── Public API ────────────────────────────────────────────────

    def list_skills(self) -> List[Dict[str, Any]]:
        """Return all registered skills."""
        return self._registry

    def get_skill(self, skill_id: str) -> Optional[Dict[str, Any]]:
        for s in self._registry:
            if s["id"] == skill_id:
                # Also read the code from file
                filepath = self.skills_dir / s["filename"]
                code = ""
                if filepath.exists():
                    code = filepath.read_text(encoding="utf-8")
                return {**s, "code": code}
        return None

    def create_skill(self, name: str, description: str, tool_name: str,
                     parameters: str, code: str) -> Dict[str, Any]:
        """Create a new skill."""
        # Validate tool_name
        tool_name = tool_name.strip().lower().replace(" ", "_")
        if not tool_name:
            raise ValueError("tool_name is required")

        # Check duplicate
        for s in self._registry:
            if s["tool_name"] == tool_name:
                raise ValueError(f"Tool name '{tool_name}' already exists")

        skill_id = datetime.now().strftime("%Y%m%d_%H%M%S") + f"_{tool_name}"
        filename = f"{tool_name}.py"

        # Write code file
        filepath = self.skills_dir / filename
        filepath.write_text(code, encoding="utf-8")

        skill = {
            "id": skill_id,
            "name": name,
            "description": description,
            "tool_name": tool_name,
            "parameters": parameters,
            "filename": filename,
            "enabled": True,
            "status": "pending",
            "error": None,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }

        self._registry.append(skill)
        self._save_registry()

        # Try loading
        self._load_skill(skill)
        self._rebuild_definitions()
        self._save_registry()

        return skill

    def update_skill(self, skill_id: str, name: str = None, description: str = None,
                     tool_name: str = None, parameters: str = None,
                     code: str = None, enabled: bool = None) -> Dict[str, Any]:
        """Update an existing skill."""
        skill = None
        for s in self._registry:
            if s["id"] == skill_id:
                skill = s
                break
        if not skill:
            raise ValueError(f"Skill not found: {skill_id}")

        old_tool_name = skill["tool_name"]

        if name is not None:
            skill["name"] = name
        if description is not None:
            skill["description"] = description
        if parameters is not None:
            skill["parameters"] = parameters
        if enabled is not None:
            skill["enabled"] = enabled

        # Handle tool_name rename
        if tool_name is not None and tool_name != old_tool_name:
            tool_name = tool_name.strip().lower().replace(" ", "_")
            # Remove old file, write new
            old_file = self.skills_dir / skill["filename"]
            new_filename = f"{tool_name}.py"
            new_file = self.skills_dir / new_filename
            if old_file.exists() and old_file != new_file:
                old_file.rename(new_file)
            skill["tool_name"] = tool_name
            skill["filename"] = new_filename

        # Update code
        if code is not None:
            filepath = self.skills_dir / skill["filename"]
            filepath.write_text(code, encoding="utf-8")

        skill["updated_at"] = datetime.now().isoformat()
        self._save_registry()

        # Reload all skills
        self._load_all_skills()
        self._save_registry()

        return skill

    def delete_skill(self, skill_id: str) -> bool:
        """Delete a skill."""
        skill = None
        for i, s in enumerate(self._registry):
            if s["id"] == skill_id:
                skill = self._registry.pop(i)
                break
        if not skill:
            return False

        # Remove file
        filepath = self.skills_dir / skill["filename"]
        if filepath.exists():
            filepath.unlink()

        # Remove from loaded
        self._loaded_tools.pop(skill["tool_name"], None)

        self._save_registry()
        self._rebuild_definitions()
        return True

    def reload_skill(self, skill_id: str) -> Dict[str, Any]:
        """Reload a single skill."""
        skill = None
        for s in self._registry:
            if s["id"] == skill_id:
                skill = s
                break
        if not skill:
            raise ValueError(f"Skill not found: {skill_id}")

        self._load_skill(skill)
        self._rebuild_definitions()
        self._save_registry()
        return skill

    def test_skill(self, skill_id: str, test_args: Dict[str, Any] = None) -> Dict[str, Any]:
        """Test a skill with optional args."""
        skill = self.get_skill(skill_id)
        if not skill:
            return {"error": "Skill not found"}

        tool_name = skill["tool_name"]
        if tool_name not in self._loaded_tools:
            return {"error": f"Skill '{skill['name']}' is not loaded. Status: {skill.get('status')}"}

        try:
            result = self._loaded_tools[tool_name](test_args or {})
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e), "traceback": traceback.format_exc()}

    def get_tool_definitions(self) -> str:
        """Return the TOOL_DEFINITIONS string for custom skills."""
        return self._tool_definitions

    def get_loaded_tools(self) -> Dict[str, callable]:
        """Return dict of loaded skill tools."""
        return self._loaded_tools
