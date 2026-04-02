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
from typing import Dict, Any, List, Optional
from datetime import datetime

logger = logging.getLogger("SkillManager")

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
SKILLS_DIR = os.path.join(DATA_DIR, "skills")
REGISTRY_FILE = os.path.join(SKILLS_DIR, "skills_registry.json")

os.makedirs(SKILLS_DIR, exist_ok=True)


class SkillManager:
    """Manages user-defined skills (Python tools) for the Agent."""

    _instance = None

    @classmethod
    def get(cls) -> "SkillManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self._registry: List[Dict[str, Any]] = []
        self._loaded_tools: Dict[str, callable] = {}
        self._tool_definitions: str = ""
        self._load_registry()
        self._load_all_skills()

    # ── Registry I/O ──────────────────────────────────────────────

    def _load_registry(self):
        if os.path.isfile(REGISTRY_FILE):
            try:
                with open(REGISTRY_FILE, "r", encoding="utf-8") as f:
                    self._registry = json.load(f)
            except Exception as e:
                logger.error(f"Failed to load skills registry: {e}")
                self._registry = []
        else:
            self._registry = []

    def _save_registry(self):
        with open(REGISTRY_FILE, "w", encoding="utf-8") as f:
            json.dump(self._registry, f, ensure_ascii=False, indent=2)

    # ── Skill Loading ─────────────────────────────────────────────

    def _load_skill(self, skill: Dict[str, Any]) -> bool:
        """Load a single skill from its Python file. Returns True on success."""
        if not skill.get("enabled", True):
            return False

        skill_file = os.path.join(SKILLS_DIR, skill["filename"])
        if not os.path.isfile(skill_file):
            logger.warning(f"Skill file not found: {skill_file}")
            return False

        try:
            spec = importlib.util.spec_from_file_location(
                f"skill_{skill['id']}", skill_file
            )
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
            logger.info(f"✅ Loaded skill: {skill['name']} → tool '{tool_name}'")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to load skill '{skill['name']}': {e}")
            skill["status"] = "error"
            skill["error"] = str(e)
            return False

    def _load_all_skills(self):
        """Load all enabled skills and rebuild tool definitions."""
        self._loaded_tools.clear()
        for skill in self._registry:
            self._load_skill(skill)
        self._rebuild_definitions()
        self._inject_into_agent_tools()

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

    def _inject_into_agent_tools(self):
        """Inject loaded skills into the agent's TOOLS registry."""
        try:
            from core.agent_tools import TOOLS
            # Remove old custom skills (those starting with skill_ prefix or in registry)
            registered_names = {s["tool_name"] for s in self._registry}
            for name in list(TOOLS.keys()):
                if name in registered_names:
                    del TOOLS[name]

            # Add currently loaded skills
            for tool_name, func in self._loaded_tools.items():
                TOOLS[tool_name] = func
                logger.info(f"🔌 Injected skill tool: {tool_name}")
        except Exception as e:
            logger.error(f"Failed to inject skills: {e}")

    # ── Public API ────────────────────────────────────────────────

    def list_skills(self) -> List[Dict[str, Any]]:
        """Return all registered skills."""
        return self._registry

    def get_skill(self, skill_id: str) -> Optional[Dict[str, Any]]:
        for s in self._registry:
            if s["id"] == skill_id:
                # Also read the code from file
                filepath = os.path.join(SKILLS_DIR, s["filename"])
                code = ""
                if os.path.isfile(filepath):
                    with open(filepath, "r", encoding="utf-8") as f:
                        code = f.read()
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
        filepath = os.path.join(SKILLS_DIR, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(code)

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
        self._inject_into_agent_tools()
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
            old_file = os.path.join(SKILLS_DIR, skill["filename"])
            new_filename = f"{tool_name}.py"
            new_file = os.path.join(SKILLS_DIR, new_filename)
            if os.path.isfile(old_file) and old_file != new_file:
                os.rename(old_file, new_file)
            skill["tool_name"] = tool_name
            skill["filename"] = new_filename

        # Update code
        if code is not None:
            filepath = os.path.join(SKILLS_DIR, skill["filename"])
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(code)

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

        # Remove from TOOLS
        try:
            from core.agent_tools import TOOLS
            if skill["tool_name"] in TOOLS:
                del TOOLS[skill["tool_name"]]
        except Exception:
            pass

        # Remove file
        filepath = os.path.join(SKILLS_DIR, skill["filename"])
        if os.path.isfile(filepath):
            os.remove(filepath)

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
        self._inject_into_agent_tools()
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
