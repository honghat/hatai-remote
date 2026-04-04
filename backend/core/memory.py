"""
Unified MemoryManager — Quản lý tất cả memory systems của agent.

- Soul: tính cách, bản sắc (soul_memory.md)
- Scratchpad: working memory cho task hiện tại
- RAG Knowledge: ChromaDB semantic search
- Episodes: tóm tắt conversations + bài học
- Preferences: sở thích, thói quen của user
"""

import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.config import (
    DATA_DIR,
    EPISODES_DIR,
    PREFERENCES_PATH,
    SCRATCHPAD_PATH,
    SOUL_PATH,
)
from core.rag_engine import RAGEngine

logger = logging.getLogger("MemoryManager")


class MemoryManager:
    _instances = {}
    _lock = threading.Lock()

    @classmethod
    def get(cls, owner_id: int = 1) -> "MemoryManager":
        """Get MemoryManager instance for a specific user ID. Default to 1 (system/default)."""
        with cls._lock:
            if owner_id not in cls._instances:
                cls._instances[owner_id] = cls(owner_id)
        return cls._instances[owner_id]

    def __init__(self, owner_id: int):
        self.owner_id = owner_id
        self.rag = RAGEngine.get()
        self._file_lock = threading.Lock()
        
        # User-specific data path
        self.user_data_dir = DATA_DIR / "users" / str(owner_id)
        self.user_data_dir.mkdir(parents=True, exist_ok=True)
        
        # Paths for this specific user
        self.preferences_path = self.user_data_dir / "preferences.json"
        self.scratchpad_path = self.user_data_dir / "scratchpad.md"
        self.soul_path = self.user_data_dir / "soul_memory.md"
        self.episodes_dir = self.user_data_dir / "episodes"
        self.episodes_dir.mkdir(exist_ok=True)

    # ── Soul ────────────────────────────────────────────────

    def get_soul(self) -> str:
        try:
            return self.soul_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            # Fallback to global soul if user hasn't defined one? 
            # Or just return empty. Let's return empty.
            return ""

    def update_soul(self, content: str):
        with self._file_lock:
            self.soul_path.write_text(content, encoding="utf-8")

    # ── Scratchpad ──────────────────────────────────────────

    def get_scratchpad(self) -> str:
        try:
            return self.scratchpad_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return ""

    def write_scratchpad(self, content: str, mode: str = "append"):
        with self._file_lock:
            if mode == "overwrite":
                self.scratchpad_path.write_text(content, encoding="utf-8")
            else:
                with open(self.scratchpad_path, "a", encoding="utf-8") as f:
                    f.write(content + "\n")

    def clear_scratchpad(self):
        with self._file_lock:
            self.scratchpad_path.write_text("", encoding="utf-8")

    # ── RAG Knowledge ───────────────────────────────────────

    def add_knowledge(self, topic: str, content: str, source: str = "agent") -> Dict[str, Any]:
        return self.rag.add_knowledge(topic, content, source, user_id=self.owner_id)

    def query_knowledge(self, topic: str, query: str, n_results: int = 3) -> Dict[str, Any]:
        return self.rag.query_knowledge(topic, query, n_results, user_id=self.owner_id)

    def query_all_knowledge(self, query: str, n_results: int = 5) -> List[Dict[str, Any]]:
        """Query across all topics in parallel, return merged results sorted by relevance.
        """
        topics = [t for t in self.rag.list_topics(user_id=self.owner_id) if not t.startswith("session_")]
        if not topics:
            return []

        all_results = []

        # ── Query all topics in parallel ──
        def _query_topic(topic):
            return topic, self.rag.query_knowledge(topic, query, n_results=3, max_distance=1.3, user_id=self.owner_id)

        with ThreadPoolExecutor(max_workers=min(len(topics), 8)) as pool:
            futures = [pool.submit(_query_topic, t) for t in topics]
            for future in as_completed(futures):
                try:
                    topic, result = future.result()
                    if "results" in result:
                        distances = result.get("distances", [0.0] * len(result["results"]))
                        for i, r in enumerate(result["results"]):
                            dist = distances[i] if i < len(distances) else 999.0
                            all_results.append({"topic": topic, "content": r, "distance": dist})
                except Exception:
                    pass

        # Sort by distance (most relevant first)
        all_results.sort(key=lambda x: x["distance"])

        # ── Hash-based deduplication (O(n) instead of O(n²)) ──
        seen_hashes = set()
        unique_results = []
        for r in all_results:
            # Use frozenset of words as fingerprint for ~80% overlap detection
            words = frozenset(r["content"].lower()[:200].split())
            # Create a coarse hash: sorted first 10 words
            fingerprint = tuple(sorted(words)[:10])
            if fingerprint not in seen_hashes:
                unique_results.append(r)
                seen_hashes.add(fingerprint)
            if len(unique_results) >= n_results:
                break

        return unique_results

    def list_topics(self) -> List[str]:
        return self.rag.list_topics(user_id=self.owner_id)

    def delete_topic(self, topic: str) -> Dict[str, Any]:
        return self.rag.delete_topic(topic, user_id=self.owner_id)

    # ── Episodes ────────────────────────────────────────────

    def save_episode(
        self,
        summary: str,
        lessons: Optional[List[str]] = None,
        mistakes: Optional[List[str]] = None,
        preferences_found: Optional[Dict[str, str]] = None,
    ) -> str:
        """Save a conversation episode. Returns filename."""
        now = datetime.now()
        filename = now.strftime("%Y-%m-%d-%H%M") + ".md"
        filepath = self.episodes_dir / filename

        lines = [
            f"# Episode {now.strftime('%Y-%m-%d %H:%M')}",
            "",
            "## Summary",
            summary,
            "",
        ]

        if lessons:
            lines.append("## Lessons Learned")
            for lesson in lessons:
                lines.append(f"- {lesson}")
            lines.append("")

        if mistakes:
            lines.append("## Mistakes to Avoid")
            for mistake in mistakes:
                lines.append(f"- {mistake}")
            lines.append("")

        if preferences_found:
            lines.append("## User Preferences Detected")
            for key, value in preferences_found.items():
                lines.append(f"- **{key}**: {value}")
            lines.append("")

        with self._file_lock:
            filepath.write_text("\n".join(lines), encoding="utf-8")

        logger.info(f"Saved episode: {filename}")
        return filename

    def get_recent_episodes(self, n: int = 10) -> List[Dict[str, Any]]:
        """Get last N episodes sorted by date (newest first)."""
        episodes = []
        try:
            files = sorted(self.episodes_dir.glob("*.md"), reverse=True)[:n]
            for f in files:
                content = f.read_text(encoding="utf-8")
                # Extract summary (first paragraph after ## Summary)
                summary = ""
                in_summary = False
                for line in content.split("\n"):
                    if line.strip() == "## Summary":
                        in_summary = True
                        continue
                    if in_summary:
                        if line.startswith("## "):
                            break
                        if line.strip():
                            summary = line.strip()
                            break

                episodes.append({
                    "filename": f.name,
                    "date": f.stem,  # e.g. "2026-03-28-1430"
                    "summary": summary,
                })
        except Exception as e:
            logger.error(f"Error reading episodes: {e}")
        return episodes

    def get_episode(self, filename: str) -> Optional[str]:
        """Read a specific episode file."""
        filepath = self.episodes_dir / filename
        if filepath.exists() and filepath.suffix == ".md":
            return filepath.read_text(encoding="utf-8")
        return None

    def search_episodes(self, query: str) -> List[Dict[str, Any]]:
        """Simple text search across episodes."""
        results = []
        query_lower = query.lower()
        try:
            for f in sorted(self.episodes_dir.glob("*.md"), reverse=True):
                content = f.read_text(encoding="utf-8")
                if query_lower in content.lower():
                    results.append({
                        "filename": f.name,
                        "date": f.stem,
                        "preview": content[:200],
                    })
        except Exception as e:
            logger.error(f"Error searching episodes: {e}")
        return results[:20]

    # ── Preferences ─────────────────────────────────────────

    def get_preferences(self) -> Dict[str, Any]:
        try:
            return json.loads(self.preferences_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def update_preferences(self, key: str, value: Any):
        with self._file_lock:
            prefs = self.get_preferences()
            prefs[key] = value
            prefs["_updated_at"] = datetime.now().isoformat()
            self.preferences_path.write_text(
                json.dumps(prefs, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    def set_preferences(self, prefs: Dict[str, Any]):
        """Replace all preferences."""
        with self._file_lock:
            prefs["_updated_at"] = datetime.now().isoformat()
            self.preferences_path.write_text(
                json.dumps(prefs, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    # ── Brain Overview (for frontend) ───────────────────────

    def get_brain_overview(self) -> Dict[str, Any]:
        """Complete brain snapshot for frontend Brain page."""
        soul = self.get_soul()
        scratchpad = self.get_scratchpad()
        topics = self.list_topics()
        episodes = self.get_recent_episodes(5)
        preferences = self.get_preferences()

        # Count knowledge entries per topic
        knowledge_details = []
        for topic in topics:
            try:
                col = self.rag._get_collection(topic, user_id=self.owner_id)
                count = col.count() if col else 0
                knowledge_details.append({"topic": topic, "count": count})
            except Exception:
                knowledge_details.append({"topic": topic, "count": 0})

        # Fetch user skills
        from core.skill_manager import SkillManager
        skills = SkillManager.get(self.owner_id).list_skills()
        
        # Built-in tools
        from core.agent_tools import TOOLS
        default_tool_names = sorted(list(TOOLS.keys()))

        return {
            "soul": {"content": soul, "size": len(soul)},
            "scratchpad": {
                "content": scratchpad[-2000:] if len(scratchpad) > 2000 else scratchpad,
                "size": len(scratchpad),
            },
            "knowledge": {"topics": knowledge_details, "total_topics": len(topics)},
            "episodes": {"recent": episodes, "total": len(list(self.episodes_dir.glob("*.md")))},
            "preferences": preferences,
            "skills": {"list": skills, "total": len(skills)},
            "default_tools": default_tool_names
        }

    def clear_all_memory(self):
        """Wipe all learned memory for THIS user (RAG, Episodes, Scratchpad, Preferences). Keeps Soul."""
        import shutil
        
        with self._file_lock:
            # 1. Clear Scratchpad
            self.clear_scratchpad()
            
            # 2. Delete all RAG topics for this user
            self.rag.clear_all_knowledge(user_id=self.owner_id)
            
            # 3. Delete all Episodes for this user
            if self.episodes_dir.exists():
                shutil.rmtree(self.episodes_dir)
                self.episodes_dir.mkdir(parents=True, exist_ok=True)
            
            # 4. Reset Preferences
            self.set_preferences({})
            
            logger.info(f"🗑️ ALL agent learned memory for user {self.owner_id} has been wiped.")
