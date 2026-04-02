"""
Self-Learning Engine — Chạy sau mỗi conversation.

Phân tích cuộc hội thoại vừa xong, rút ra:
- Summary: tóm tắt ngắn
- Lessons: kiến thức hữu ích
- Preferences: user thích/ghét gì
- Mistakes: lỗi cần tránh lần sau
"""

import json
import logging
import re
import threading
from typing import List, Dict, Any, Optional

ANALYSIS_PROMPT = """You are a self-learning AI assistant analyzing a completed conversation.
Extract insights and knowledge from this conversation. Be concise and specific.

Output ONLY valid JSON (no markdown, no code blocks):
{
  "summary": "1-2 sentence summary of what happened",
  "knowledge": [{"topic": "category", "fact": "detailed information learned"}],
  "lessons": ["useful technique or behavior improvement", ...],
  "preferences": {"key": "value"},
  "mistakes": ["actual error made that should be avoided", ...]
}

Rules:
- summary: What was achieved and the outcome.
- knowledge: NEW facts, data, or information shared. Skip if it's common sense.
- lessons: AI-specific behavior improvements (e.g. "I should use tool X more").
- preferences: User habits, style, naming, etc.
- mistakes: Failures or errors to avoid.
- If nothing useful discovered for a field, use empty array/object.
- Maximum 3 items per array. Vietnamese language if applicable."""


def _format_conversation(messages: List[Dict[str, Any]], max_chars: int = 5000) -> str:
    """Format last N chars of conversation for analysis."""
    lines = []
    for msg in messages:
        role = msg.get("role", "unknown").upper()
        content = msg.get("content", "")
        if isinstance(content, list):
            content = " ".join(
                part.get("text", "") for part in content if isinstance(part, dict)
            )
        # Skip internal system logs or technical noise
        if role == "SYSTEM" or len(str(content).strip()) < 5:
            continue
        # Truncate very long tool outputs
        if len(str(content)) > 800:
            content = str(content)[:800] + "..."
        lines.append(f"{role}: {content}")

    text = "\n".join(lines)
    if len(text) > max_chars:
        text = text[-max_chars:]
    return text


def _parse_json_response(text: str) -> Optional[Dict[str, Any]]:
    """Parse JSON from LLM response, handling common issues."""
    text = text.strip()
    # Remove markdown code blocks if present
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON object in text
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return None


logger = logging.getLogger("Learner")


def learn_from_conversation(messages: List[Dict[str, Any]]):
    """
    Analyze a completed conversation and extract learnings.
    Should be called in a background thread after conversation ends.
    """
    from core.memory import MemoryManager
    from core.llm_engine import LLMEngine

    logger.info("🧠 Brain Analysis: Starting self-learning process...")

    try:
        engine = LLMEngine.get()
        if not engine.is_ready:
            logger.warning("LLM not ready, skipping learning")
            return

        memory = MemoryManager.get()

        # Thresholds
        user_messages = [m for m in messages if m.get("role") == "user"]
        if len(user_messages) < 1: # Reduced to 1 to capture even single-turn knowledge
            logger.info("Conversation too short, skipping learning")
            return

        conv_text = _format_conversation(messages)
        if len(conv_text.strip()) < 50:
            logger.info("Conversation content too short, skipping learning")
            return

        # Single LLM call for analysis
        logger.info(f"🧠 Brain Analysis: Prompting {engine.provider} for insights...")
        response = engine.chat_sync(
            messages=[
                {"role": "system", "content": ANALYSIS_PROMPT},
                {"role": "user", "content": conv_text},
            ],
            max_tokens=600,
            temperature=0.1,
        )

        if not response:
            logger.warning("Empty LLM response for learning")
            return

        parsed = _parse_json_response(response)
        if not parsed:
            logger.warning(f"Failed to parse learning response: {response[:300]}")
            return

        summary = parsed.get("summary", "")
        extracted_knowledge = parsed.get("knowledge", [])
        lessons = parsed.get("lessons", [])
        preferences = parsed.get("preferences", {})
        mistakes = parsed.get("mistakes", [])

        # 1. Save episode
        if summary:
            memory.save_episode(
                summary=summary,
                lessons=lessons if lessons else None,
                mistakes=mistakes if mistakes else None,
                preferences_found=preferences if preferences else None,
            )
            logger.info(f"✅ Episode saved: {summary}")

        # 2. Update preferences
        if isinstance(preferences, dict):
            for key, value in preferences.items():
                if key and value and not str(key).startswith("_"):
                    memory.update_preferences(str(key), str(value))
            if preferences:
                logger.info(f"✅ Preferences updated: {list(preferences.keys())}")

        # 3. Store new knowledge in RAG
        if isinstance(extracted_knowledge, list):
            for item in extracted_knowledge:
                if isinstance(item, dict) and "fact" in item:
                    topic = item.get("topic", "general")
                    fact = item.get("fact", "")
                    if fact:
                        memory.add_knowledge(topic, fact, source="self_learning")
            if extracted_knowledge:
                logger.info(f"✅ Extracted {len(extracted_knowledge)} new facts to RAG")

        # 4. Store lessons in RAG
        if isinstance(lessons, list):
            for lesson in lessons:
                if isinstance(lesson, str) and lesson.strip():
                    memory.add_knowledge("lessons", lesson.strip(), source="self_learning")
            if lessons:
                logger.info(f"✅ Logged {len(lessons)} improvements")

        # 5. Store mistakes in RAG
        if isinstance(mistakes, list):
            for mistake in mistakes:
                if isinstance(mistake, str) and mistake.strip():
                    memory.add_knowledge("mistakes", mistake.strip(), source="self_learning")
            if mistakes:
                logger.info(f"✅ Logged {len(mistakes)} mistakes to avoid")

        logger.info("🧠 Brain Analysis: Learning complete.")

    except Exception as e:
        logger.error(f"Learning failed: {e}", exc_info=True)


def trigger_learning(messages: List[Dict[str, Any]]):
    """Trigger learning in background thread. Non-blocking."""
    thread = threading.Thread(
        target=learn_from_conversation,
        args=(messages,),
        daemon=True,
        name="learner",
    )
    thread.start()
    logger.info("Learning triggered in background")
