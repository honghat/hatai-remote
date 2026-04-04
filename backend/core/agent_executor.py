"""
AI Agent Executor - loop: LLM -> parse tool calls -> execute -> feed results back
Streams all steps via SSE events so the frontend can display progress.

v4: Planning + step-by-step execution + token-limit continuation + self-learning.
    After each conversation, learner extracts lessons/preferences/mistakes.
"""
import os
import re
import json
import logging
import contextvars
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Generator

# Traces the active chat session (for background tasks to know where to report back)
current_session_id = contextvars.ContextVar("current_session_id", default=None)

from core.llm_engine import LLMEngine
from core.agent_tools import TOOL_DEFINITIONS, execute_tool, _read_scratchpad, tool_scratchpad, cleanup_agent_browser_tabs, _agent_opened_urls
from core.config import MODEL_N_CTX
from core.memory import MemoryManager

logger = logging.getLogger("AgentExecutor")

MAX_ITERATIONS = 2000
PLAN_MAX_TOKENS = 300
PLAN_BYPASS_LENGTH = 100  # Skip planning for very short or simple prompts

# ── Token-limit continuation ──────────────────────────────────────────────────
def _is_truncated(text: str, finish_reason: str) -> bool:
    """Return True only when the LLM was hard-stopped by token limit.

    Only trust finish_reason == "length" (authoritative from API).
    Pattern matching is kept minimal to avoid false positives on normal text.
    """
    if finish_reason == "length":
        return True

    if not text:
        return False

    # Only flag open code block that was never closed — very reliable signal
    # Count ``` occurrences: odd number means one is unclosed
    backtick_count = text.count("```")
    if backtick_count % 2 == 1:
        return True

    return False




def _load_episodes_with_lessons(memory) -> str:
    """Load recent episodes with lessons extracted — runs in thread pool."""
    recent_episodes = memory.get_recent_episodes(5)
    if not recent_episodes:
        return ""
    ep_parts = []
    for e in recent_episodes:
        ep_line = f"- **{e['date']}**: {e['summary']}"
        if e.get('filename'):
            full_ep = memory.get_episode(e['filename'])
            if full_ep:
                lessons = []
                in_lessons = False
                for line in full_ep.split("\n"):
                    if "## Lessons" in line:
                        in_lessons = True
                        continue
                    if in_lessons:
                        if line.startswith("## "):
                            break
                        if line.strip().startswith("- "):
                            lessons.append(line.strip())
                if lessons:
                    ep_line += "\n  " + "\n  ".join(lessons[:2])
        ep_parts.append(ep_line)
    return "\n\n## RECENT CONVERSATIONS & LESSONS:\n" + "\n".join(ep_parts)


def _load_rag_context(memory, user_query: str, session_id: int = None) -> str:
    """Load RAG knowledge context — runs in thread pool."""
    if not user_query:
        return ""
    rag_context = ""
    relevant = memory.query_all_knowledge(user_query, n_results=5)
    if relevant:
        rag_list = []
        for r in relevant:
            dist_label = ""
            dist = r.get("distance", 999)
            if dist < 0.5:
                dist_label = " ⭐"
            rag_list.append(f"- [{r['topic']}]{dist_label}: {r['content']}")
        rag_context = "\n\n## RELEVANT KNOWLEDGE:\n" + "\n".join(rag_list)

    if session_id:
        session_topic = f"session_{session_id}"
        session_knowledge = memory.query_knowledge(session_topic, user_query, n_results=3)
        if isinstance(session_knowledge, dict) and "results" in session_knowledge:
            session_results = session_knowledge.get("results")
            if session_results:
                session_list = [f"- {r}" for r in session_results]
                rag_context += "\n\n## SESSION CONTEXT (from earlier in this conversation):\n" + "\n".join(session_list)
    return rag_context


def build_system_prompt(user_query: str = "", session_id: int = None) -> str:
    memory = MemoryManager.get()

    # ── Load lightweight memory only (soul + prefs) ──
    # RAG knowledge and episodes are loaded ON-DEMAND via query_knowledge/session_query tools
    # This keeps the system prompt lean and avoids constant context trimming
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_soul = pool.submit(memory.get_soul)
        f_prefs = pool.submit(memory.get_preferences)

        soul = f_soul.result()
        prefs = f_prefs.result()

    soul_section = f"\n\n## CORE DIRECTIVES (Soul):\n{soul}\n" if soul else ""

    prefs_summary = ""
    if prefs:
        prefs_list = [f"- {k}: {v}" for k, v in prefs.items() if not k.startswith("_")]
        if prefs_list:
            prefs_summary = "\n\n## USER PREFERENCES:\n" + "\n".join(prefs_list)

    # 5. Custom Skills
    custom_skills = ""
    try:
        from core.skill_manager import SkillManager
        skill_defs = SkillManager.get().get_tool_definitions()
        if skill_defs:
            custom_skills = "\n" + skill_defs
    except Exception:
        pass

    import datetime
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:00")

    # 6. Project Context (CWD and Root)
    cwd = os.getcwd()
    project_root = cwd
    # Try to find a .git folder or workspace marker to define project root
    temp_root = cwd
    for _ in range(3):
        if os.path.exists(os.path.join(temp_root, ".git")) or os.path.exists(os.path.join(temp_root, "package.json")):
            project_root = temp_root
            break
        parent = os.path.dirname(temp_root)
        if parent == temp_root: break
        temp_root = parent

    project_context = f"""
# Project Context
- **Current Working Directory (CWD)**: `{cwd}`
- **Project Root**: `{project_root}`
- **IMPORTANT**: ALWAYS use paths relative to the Project Root or CWD. Do NOT use absolute paths starting with `//` or `/Users/...` unless explicitly instructed.
- If you are building a new feature, ensure files are placed in their correct semantic directories (e.g., `backend/core/`, `frontend/src/components/`).
"""

    return f"""You are HatAI Agent — an advanced AI assistant running on macOS. 
Current time: {now_str}. 
IMPORTANT: Today is {now_str.split(' ')[0]}. If the user asks for "hôm nay", "mới nhất", "tin tức", or any time-sensitive info, you MUST include the current date or "today" in your search query to get real-time results.
{project_context}

# How to think
- ALWAYS start your response with a <think> block (or <thought>).
- For complex tasks (searching, browsing, system actions), reason step-by-step.
- Use clear step headers to organize your reasoning.
- **IMPORTANT**: If the user's query is short or simple, answer DIRECTLY and CONCISELY. Do NOT repeat or summarize the code unless explicitly requested.
- For simple greetings, use a VERY BRIEF thinking block just to acknowledge the intent.
- Do NOT stutter, repeat words, or leak your internal monologue into the final response.
- Provide the final response in Vietnamese.
- If you were previously "lost" in the wrong directory, use `project_tree` or `list_dir` to re-orient yourself in the current project root.

# How to use tools
- Call tools using this exact format:
```tool
{{"tool": "tool_name", "args": {{"key": "value"}}}}
```
- If you cannot use code blocks, output raw JSON:
{{"tool": "tool_name", "args": {{"key": "value"}}}}

# Core principles
- **Accuracy over speed**: NEVER guess or fabricate data. If search results contain numbers, prices, dates — quote them EXACTLY as found. If data is unclear, say so.
- **Verify before presenting**: When extracting data from search results, cross-check across multiple sources. If sources conflict, present both with attribution.
- **Cite sources**: Always include URLs when presenting factual information from the web.
- **Be concise**: Give direct answers in your final response. No filler or unnecessary commentary.
- **Persistence (CRITICAL)**: Keep working until the goal is 100% complete. If one approach fails, try another. You are a background-capable agent; do NOT stop or ask for permission if the goal is not yet reached. Proceed until the task is verified done.
- **Minimal tools**: Use the fewest tool calls needed. Don't call tools unnecessarily.

# Internal Reasoning (Thinking)
- ALWAYS start your response with a `<think>` block (or `<thought>`).
- Use this block to analyze the user's intent, plan your strategy, and evaluate tool results.
- **Be DETAILED** for complex tasks: Show your logical chain of thought.
- **Be BRIEF** for greetings: Just 1-2 sentences of internal context.
- The user can see this thinking process in the UI, so use it to provide transparency on complex tasks.
- If a tool fails, use the thinking block to figure out a better alternative.

# Search & Research
- Use `deep_search` for ANY web research. It searches Google, crawls pages, and returns full content.
- For "today's news" or "tin tức hôm nay": 
  1. Use `deep_search` with the current date (e.g., `deep_search(query="tin tức vnexpress {now_str.split(' ')[0]}")`).
  2. OR use `site_search` with `site="google"` and a time-bound query.
- After receiving search results: READ the full `combined_content` carefully. Extract EXACT data (numbers, prices, names) — do NOT paraphrase numbers or make up statistics.
- When presenting search results, structure your answer with:
  - Key facts/data (exact numbers from sources)
  - Source attribution (URL or site name)
  - Brief analysis if relevant

# Browser & Desktop Persistence
- IMPORTANT: `browser_go`, `open_browser`, and all browser tools use the **LAST OPENED BROWSER** by default.
- If the user asks for a specific browser (e.g., "mở Brave"), you MUST first call `sys_open_app` for that browser. This sets the default browser for all subsequent steps.
- If you haven't opened any browser yet, the default is "Google Chrome".
- Always use `sys_get_active_app` to verify what is currently in focus before typing or clicking.

# Mandatory Visual Verification
- **NEVER assume an action worked**. 
- After EVERY `browser_go`, `browser_click`, `browser_type`, `sys_key`, or `sys_click`, you **MUST** call `browser_read` (for browsers) or `screenshot` (for desktop apps).
- Read the tool result AND look at the screenshot content to verify the screen state before moving to the next step.

# Presentation Style & Aesthetics (CRITICAL)
- **WOW THE USER**: Your final response must look professional, premium, and extremely well-organized.
- **Use Rich Markdown**: 
  - Use **EMOJI** icons for every section (e.g., 📌, 🎯, 🏞️, 💰).
  - Use **BOLD** for important keywords and headers.
  - Use **CLEAN TABLES** for data (prices, dates, comparisons). Ensure tables have clear headers.
  - Use **BULLET POINTS** instead of long paragraphs.
- **NO FILLER**: In your **final response** (outside of thinking tags), do NOT say "Based on my research...", "Thought Process", or "Here is what I found...". Start directly with the information.
- **NO REDUNDANCY**: The UI already displays your internal reasoning. Do NOT repeat your thought process in the final answer/output. Keep the final answer clean and result-oriented.
- **Whitespace**: Use empty lines between sections to create a "breathable" design.

# Professional Coding (CRITICAL for code tasks)
- **READ BEFORE EDIT**: ALWAYS use `read_file` with `start_line`/`end_line` to read the specific section BEFORE editing. Never edit blind.
- **Precise Edits**: Use `edit_file{{path,old_text,new_text}}` for single edits. Use `multi_edit_file{{path,edits}}` for multiple non-contiguous changes in one file.
- **Verify After Edit**: After editing, use `read_file` to verify the change was applied correctly. If it broke syntax, fix immediately.
- **Project Overview**: Use `project_tree{{path,depth}}` to understand file structure before diving into code.
- **Search First**: Use `search_code{{query,path}}` to find where code is defined before modifying it. Don't guess file locations.
- **Git Workflow**: Use `git_ops` for version control:
  - `git_ops{{action:"status"}}` — check current state
  - `git_ops{{action:"diff",file:"path"}}` — review changes before committing  
  - `git_ops{{action:"commit",message:"desc"}}` — commit with clear message
  - `git_ops{{action:"push"}}` — push to remote
  - `git_ops{{action:"log",n:5}}` — check recent history
- **Line Numbers Matter**: When reading code, use line ranges to focus on relevant sections. Don't read entire large files.
- **Create Files**: Use `write_file{{path,content}}` to create new files. Create parent directories automatically.
- **Run & Test**: After code changes, use `run_command` to test (e.g., `python -c "import module"`, `node -e "require('./file')"`, `npm run build`).
- **Error Recovery**: If an edit fails (old_text not found), read the file again to see current content, then retry with correct text.

# Vision & Attachments
- **Direct Perception**: For any images attached to the chat (JPEG, PNG, WEBP) OR screenshots generated by tools, you can directly "SEE" and analyze them in your thoughts. You do NOT need a tool for basic vision.
- **Attachments vs Screenshots**: 
  - Attached images are provided by the user. 
  - Screenshots are generated by your own actions (e.g., `tool_screenshot`). 
  - Both appear in your visual field identically.
- **Grounding (NO Hallucination)**: 
  - If you cannot "see" an image for any reason (e.g., model error, image is missing, or blurred), you MUST explicitly state it. 
  - NEVER fabricate, guess, or make up content from an image you cannot see. 
  - Accuracy is your highest priority.
- **Tool Selection**: 
  - Do NOT call `read_file` on binary image files. It will fail. 
  - If you need a more advanced, multi-step analysis or OCR of a document/image (like a multi-page PDF or a complex report), use `tool_analyze_document`.
- **Paths**: The user prompt mentions file locations like `[Đính kèm: Filename tại Path]`. Use these only for referencing the specific file in your thoughts or when calling tools.

# Document Analysis
- For deep financial reports, long PDF, or large Excel files, use `analyze_document`.
- `analyze_document` uses a Multi-pass (MapReduce) strategy to ensure details are not lost in the context window.
- It is much more accurate than `read_file` for complex documents.
- Use `focus` argument to tell the tool what specific data you are looking for.

# Planning
- When the user asks for an interactive task, your plan MUST include verification steps: 
  1. `sys_open_app`
  2. `browser_go`
  3. `browser_read` (Verification)
  4. ...next actions...
  5. `browser_read`/`screenshot` (Final Verification)

# Memory & Context (ON-DEMAND)
- You have a persistent memory system. Use these tools to access it:
  - `session_query{{query,n?}}` — **PRIMARY tool for knowledge lookup**. Searches session data first, then falls back to global knowledge base automatically. Use this for ANY knowledge question.
  - `query_knowledge{{topic,query}}` — search RAG knowledge base by specific topic (use when you know the exact topic)
  - `remember{{content,type,topic?}}` — save important findings for future use
  - `deep_search{{query}}` — search the web and auto-index results into session memory for later `session_query` retrieval
- ALWAYS query memory BEFORE answering complex questions or when the user references past conversations.
- Do NOT assume you know something — if unsure, query first.
- For research tasks: use `deep_search` first to gather data, then `session_query` to retrieve specific details.

{TOOL_DEFINITIONS}
{custom_skills}
{soul_section}{prefs_summary}"""



def _try_parse_json(text):
    """Try to parse JSON with progressive repair strategies."""
    text = text.strip()
    if not text:
        return None
    # Attempt 1: Direct parse
    try:
        return json.loads(text)
    except Exception:
        pass
    # Attempt 2: Replace single quotes with double quotes (careful with apostrophes)
    try:
        # Only replace quotes that look like JSON delimiters (around keys/values)
        fixed = re.sub(r"(?<=[\[{,:])\s*'|'\s*(?=[,}\]:])", '"', text)
        return json.loads(fixed)
    except Exception:
        pass
    # Attempt 3: Fix missing closing braces
    if text.count('{') > text.count('}'):
        try:
            return json.loads(text + '}' * (text.count('{') - text.count('}')))
        except Exception:
            pass
    # Attempt 4: Fix trailing comma before }
    try:
        fixed = re.sub(r',\s*}', '}', text)
        fixed = re.sub(r',\s*]', ']', fixed)
        return json.loads(fixed)
    except Exception:
        pass
    # Attempt 5: Strip non-JSON prefix/suffix (model adds explanation around JSON)
    json_match = re.search(r'(\{.*"tool"\s*:\s*"[^"]+".+\})', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except Exception:
            # Try with brace fix
            candidate = json_match.group(1)
            if candidate.count('{') > candidate.count('}'):
                try:
                    return json.loads(candidate + '}' * (candidate.count('{') - candidate.count('}')))
                except Exception:
                    pass
    return None


def _parse_tool_calls(content: str) -> List[tuple]:
    """
    Highly permissive tool call parser. Returns a list of (tool_name, args) tuples.
    Designed to handle messy output from small models (Qwen3-4B etc.).
    """
    calls = []

    def _extract_args(data):
        """Extract args from tool call dict — handles both {"tool":"x","args":{...}}, {"tool":"x","arguments":{...}}, and {"tool":"x","key":"val",...}"""
        # 1. Standard "args" or "arguments" key
        a = data.get("args") or data.get("arguments")
        if a is not None and isinstance(a, dict):
            return a
            
        # 2. If 'args' is a string (hallucination), try to parse it
        if isinstance(a, str):
            try: return json.loads(a)
            except: return {"query": a} # Fallback for search-like tools
            
        # 3. Flat format: everything except "tool" key is an arg
        return {k: v for k, v in data.items() if k != "tool"}

    # Strategy 1: Extract from code blocks (```tool, ```json, ```)
    code_blocks = re.findall(r'```(?:[a-z]*)\s*\n?(.*?)\n?\s*```', content, re.DOTALL)

    # Strategy 2: If no code blocks, try 'tool { ... }' pattern
    if not code_blocks:
        tool_json_blocks = re.findall(r'tool\s*(\{[\s\S]*?\})', content, re.DOTALL)
        if tool_json_blocks:
            code_blocks = tool_json_blocks

    # Strategy 3: Try raw JSON objects anywhere in content
    if not code_blocks:
        # Match nested JSON: {..."tool"...{...}...}
        maybe_json = re.findall(r'(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})', content, re.DOTALL)
        if maybe_json:
            code_blocks = maybe_json

    # Strategy 4: If still nothing, try to find "tool": "xxx" pattern and extract surrounding JSON
    if not code_blocks:
        tool_ref = re.search(r'["\']tool["\']\s*:\s*["\']([a-z_]+)["\']', content)
        if tool_ref:
            # Try to extract the JSON object around this match
            start = content.rfind('{', 0, tool_ref.start())
            if start >= 0:
                # Find matching close
                depth = 0
                for idx in range(start, len(content)):
                    if content[idx] == '{':
                        depth += 1
                    elif content[idx] == '}':
                        depth -= 1
                    if depth == 0:
                        code_blocks = [content[start:idx + 1]]
                        break
                if not code_blocks and depth > 0:
                    # Unclosed — add missing braces
                    code_blocks = [content[start:] + '}' * depth]

    for block in code_blocks:
        block = block.strip()
        if not block:
            continue

        data = _try_parse_json(block)
        if data is not None:
            if isinstance(data, dict) and "tool" in data:
                calls.append((data["tool"], _extract_args(data)))
                continue
            elif isinstance(data, list):
                found_in_list = False
                for item in data:
                    if isinstance(item, dict) and "tool" in item:
                        calls.append((item["tool"], _extract_args(item)))
                        found_in_list = True
                if found_in_list:
                    continue

        # Try function-like fallback: tool_name(arg='val')
        m = re.search(r'([a-z_]+)\((.*?)\)', block)
        if m:
            tname, raw_args = m.group(1), m.group(2)
            from core.agent_tools import TOOLS
            if tname in TOOLS:
                args = {k: v for k, v in re.findall(r"([a-z_]+)\s*=\s*['\"](.*?)['\"]", raw_args)}
                calls.append((tname, args))

    # Strategy 4: Last resort — if no calls found, check if ANY known tool name
    # appears in the content and try to extract a call from context
    if not calls:
        from core.agent_tools import TOOLS
        content_lower = content.lower()
        has_tool_ref = ('"tool"' in content or "'tool'" in content or
                        any(t in content_lower for t in TOOLS))
        if has_tool_ref:
            auto = _auto_fix_tool_call(content)
            if auto:
                calls.append(auto)
                logger.info(f"🔧 Parser last-resort extracted: {auto[0]}")

    return calls


def _auto_fix_tool_call(content: str):
    """Last-resort attempt to extract a tool call from malformed LLM output.

    Looks for common patterns like tool names and argument values even
    when the JSON is broken. Returns (tool_name, args_dict) or None.
    """
    from core.agent_tools import TOOLS

    content_lower = content.lower()

    # Try to find a tool name mentioned in the text — prioritize longer matches first
    # (e.g. "browser_go" before "browser", "sys_open_app" before "sys_key")
    found_tool = None
    sorted_tools = sorted(TOOLS.keys(), key=len, reverse=True)
    for tool_name in sorted_tools:
        # Match tool name as a distinct token (not substring of another word)
        if re.search(r'(?:^|[\s"\'{,:])' + re.escape(tool_name) + r'(?:$|[\s"\'},:])', content_lower):
            found_tool = tool_name
            break

    if not found_tool:
        return None

    # Try to extract arguments from broken JSON or natural language
    args = {}

    # Pattern 1: key-value pairs in JSON-like format "key": "value" or 'key': 'value'
    kv_pairs = re.findall(r'["\'](\w+)["\']\s*:\s*["\']([^"\']+)["\']', content)
    for k, v in kv_pairs:
        if k not in ("tool", "type"):
            args[k] = v

    # Pattern 2: tool-specific smart extraction (when Pattern 1 fails)
    if not args:
        if found_tool == "sys_open_app":
            app_match = re.search(r'(?:app_name|app|mở|open)\s*[=:]\s*["\']?([A-Za-z\s]+)', content, re.IGNORECASE)
            if app_match:
                args["app_name"] = app_match.group(1).strip().strip("\"'")
            elif "brave" in content_lower:
                args["app_name"] = "Brave Browser"
            elif "chrome" in content_lower:
                args["app_name"] = "Google Chrome"
            elif "safari" in content_lower:
                args["app_name"] = "Safari"
            elif "firefox" in content_lower:
                args["app_name"] = "Firefox"

        elif found_tool == "fb_message":
            # Extract contact and message from surrounding text
            contact_match = re.search(r'(?:cho|for|to|contact)\s*[=:]?\s*["\']?([A-ZÀ-Ỹa-zà-ỹ\s]{2,30}?)(?:["\']|(?:\s+(?:là|saying|that|với|nội dung|message)))', content, re.IGNORECASE)
            msg_match = re.search(r'(?:là|saying|that|message|nội dung|content)\s*[=:]?\s*["\'](.+?)["\']', content, re.IGNORECASE)
            if contact_match:
                args["contact"] = contact_match.group(1).strip()
            if msg_match:
                args["message"] = msg_match.group(1).strip()
            # Also try to find quoted strings as fallbacks
            if not args.get("contact") or not args.get("message"):
                quoted = re.findall(r'"([^"]{2,})"', content)
                for q in quoted:
                    if not args.get("message") and len(q) > 5:
                        args["message"] = q
                    elif not args.get("contact") and len(q) <= 30:
                        args["contact"] = q

        elif found_tool in ("browser_go", "open_browser"):
            url_match = re.search(r'(https?://[^\s"\'<>]+)', content)
            if url_match:
                args["url"] = url_match.group(1).rstrip('.,;)')
            elif "youtube" in content_lower:
                args["url"] = "https://www.youtube.com"
            elif "facebook" in content_lower or "fb" in content_lower:
                args["url"] = "https://www.facebook.com"
            elif "google" in content_lower:
                args["url"] = "https://www.google.com"

        elif found_tool == "browser_type":
            # Try to find text and selector
            text_match = re.search(r'(?:text|nhập|type|input)\s*[=:]\s*["\']([^"\']+)["\']', content, re.IGNORECASE)
            sel_match = re.search(r'(?:selector|css|element)\s*[=:]\s*["\']([^"\']+)["\']', content, re.IGNORECASE)
            if text_match:
                args["text"] = text_match.group(1)
            if sel_match:
                args["selector"] = sel_match.group(1)
            # YouTube search specific
            if not args.get("selector") and "youtube" in content_lower and ("search" in content_lower or "tìm" in content_lower):
                args["selector"] = "input#search"
            if not args.get("text"):
                # Try to find quoted text
                quoted = re.findall(r'"([^"]{3,})"', content)
                for q in quoted:
                    if q not in TOOLS and q != found_tool:
                        args["text"] = q
                        break

        elif found_tool == "browser_click":
            sel_match = re.search(r'(?:selector|css|element)\s*[=:]\s*["\']([^"\']+)["\']', content, re.IGNORECASE)
            if sel_match:
                args["selector"] = sel_match.group(1)
            elif "search" in content_lower:
                args["selector"] = "button#search-icon-legacy"

        elif found_tool == "browser_read":
            args = {}  # No args needed

        elif found_tool == "screenshot":
            args = {}  # No args needed

        elif found_tool == "deep_search":
            query_match = re.search(r'(?:query)\s*[=:]\s*["\']([^"\']+)["\']', content, re.IGNORECASE)
            if query_match:
                args["query"] = query_match.group(1)
            else:
                # Try to find quoted search text
                quoted = re.findall(r'"([^"]{3,})"', content)
                for q in quoted:
                    if q not in TOOLS and q != found_tool:
                        args["query"] = q
                        break

        elif found_tool in ("read_file", "write_file"):
            path_match = re.search(r'(?:path)\s*[=:]\s*["\']([^"\']+)["\']', content, re.IGNORECASE)
            if path_match:
                args["path"] = path_match.group(1)

        elif found_tool == "run_command":
            cmd_match = re.search(r'(?:command|cmd)\s*[=:]\s*["\']([^"\']+)["\']', content, re.IGNORECASE)
            if cmd_match:
                args["command"] = cmd_match.group(1)

        elif found_tool == "sys_key":
            key_match = re.search(r'(?:key)\s*[=:]\s*["\']([^"\']+)["\']', content, re.IGNORECASE)
            if key_match:
                args["key"] = key_match.group(1)
            if "enter" in content_lower or "return" in content_lower:
                args.setdefault("key", "Return")

    # For tools that need no args, return them directly
    if found_tool in ("browser_read", "screenshot", "sys_get_active_app", "get_current_time") and not args:
        return (found_tool, {})

    if args:
        return (found_tool, args)

    return None


def _suggest_tool_for_task(user_message: str, plan_steps: list, current_step: int) -> str:
    """Generate a concrete tool call example based on the user's task.

    This helps the model recover when it can't format tool calls properly.
    """
    msg = user_message.lower()

    # Facebook messaging
    if "facebook" in msg or "fb" in msg or "nhắn tin" in msg or "messenger" in msg:
        contact = ""
        message = ""
        # Pattern 1: "nhắn tin cho X là "Y"" (quoted message)
        m = re.search(r'(?:cho|for|to)\s+(.+?)\s+(?:là|saying|that|:)\s*"(.+?)"', user_message, re.IGNORECASE)
        if not m:
            # Pattern 2: "nhắn tin cho X là Y" (unquoted)
            m = re.search(r'(?:cho|for|to)\s+(.+?)\s+(?:là|saying|that|:)\s+(.+?)$', user_message, re.IGNORECASE)
        if not m:
            # Pattern 3: "message X "Y""
            m = re.search(r'(?:nhắn tin|message|gửi)\s+(?:cho\s+)?(.+?)\s+"(.+?)"', user_message, re.IGNORECASE)
        if m:
            contact = m.group(1).strip().strip('"\'')
            message = m.group(2).strip().strip('"\'')
        return json.dumps({"tool": "fb_message", "args": {"contact": contact or "Tên người", "message": message or "Nội dung tin nhắn"}}, ensure_ascii=False)

    # Browser navigation
    if "youtube" in msg:
        return '{"tool": "browser_go", "args": {"url": "https://www.youtube.com"}}'
    if "google" in msg:
        return '{"tool": "browser_go", "args": {"url": "https://www.google.com"}}'
    if any(w in msg for w in ["mở", "open", "browse", "truy cập", "vào"]):
        return '{"tool": "browser_go", "args": {"url": "https://www.google.com"}}'

    # Search
    if any(w in msg for w in ["tìm", "search", "kiếm", "tra cứu"]):
        return '{"tool": "deep_search", "args": {"query": "' + user_message[:60] + '"}}'

    # File operations
    if any(w in msg for w in ["đọc", "read", "xem file"]):
        return '{"tool": "read_file", "args": {"path": "/path/to/file"}}'

    # Default: use the plan step hint
    if plan_steps and current_step < len(plan_steps):
        step = plan_steps[current_step]
        if "browser" in step.lower() or "web" in step.lower():
            return '{"tool": "browser_go", "args": {"url": "https://www.google.com"}}'
        if "search" in step.lower():
            return '{"tool": "deep_search", "args": {"query": "example search"}}'

    return '{"tool": "screenshot", "args": {}}'


def _process_tool_result(tname: str, res, vision_blocks: list) -> tuple:
    """Process a tool result: handle screenshots, truncate, return (cleaned_res, res_txt)."""
    # _frontend_screenshot and screenshot base64 are yielded by caller
    if isinstance(res, dict) and "_frontend_screenshot" in res:
        res = {k: v for k, v in res.items() if k not in ("_frontend_screenshot", "_frontend_screenshot_path")}

    if isinstance(res, dict) and "base64" in res:
        vision_blocks.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{res['base64']}"}})
        res_no_img = {k: v for k, v in res.items() if k != "base64"}
        res_txt = json.dumps(res_no_img, ensure_ascii=False, default=str)
    else:
        res_txt = json.dumps(res, ensure_ascii=False, default=str)

    # Compression limits by tool type
    if tname in ("deep_search", "web_search", "read_web"):
        max_result_len = 6000
    elif tname in ("read_file", "browser_read", "get_page_text", "analyze_document"):
        max_result_len = 2000
    elif tname in ("run_command", "search_code", "list_dir"):
        max_result_len = 1200
    else:
        max_result_len = 800

    if len(res_txt) > max_result_len:
        if tname in ("deep_search", "web_search", "read_web"):
            head = int(max_result_len * 0.85)
            tail = max_result_len - head
        else:
            head = int(max_result_len * 0.7)
            tail = max_result_len - head
        res_txt = res_txt[:head] + f"...[{len(res_txt)-max_result_len} chars cut]..." + res_txt[-tail:]

    return res, res_txt


_token_cache: Dict[int, int] = {}  # id(content) -> token estimate

def _estimate_tokens(text: Any) -> int:
    """Estimate token count. Uses ~4 chars/token for ASCII, ~2 chars/token for CJK/Vietnamese.
    Results are cached by object id to avoid re-computation in trim loops."""
    if not text: return 0
    if isinstance(text, list):
        total = 0
        for p in text:
            if isinstance(p, dict) and p.get("type") == "image_url":
                total += 85
            else:
                total += _estimate_tokens(str(p))
        return total
    # Cache by object id — valid as long as the string object lives
    text_id = id(text)
    cached = _token_cache.get(text_id)
    if cached is not None:
        return cached
    s = str(text)
    non_ascii = sum(1 for c in s if ord(c) > 127)
    ascii_count = len(s) - non_ascii
    result = (ascii_count // 4) + (non_ascii // 2) + 1
    # Keep cache bounded
    if len(_token_cache) > 2000:
        _token_cache.clear()
    _token_cache[text_id] = result
    return result

def _fast_summarize(messages_to_summarize, original_goal):
    """Fast text-based summary without LLM call. Extracts key tool results and findings."""
    parts = []
    for m in messages_to_summarize:
        role = m.get("role", "?")
        content = m.get("content", "")
        if isinstance(content, list):
            content = " ".join(str(p.get("text", "")) for p in content if isinstance(p, dict) and p.get("type") == "text")
        text = str(content)
        # Tool results — keep more context for search results (they contain key data)
        if role == "user" and text.startswith("[") and "]:" in text[:40]:
            tool_name = text.split("]")[0][1:] if "]" in text[:40] else ""
            if tool_name in ("deep_search", "web_search", "read_web", "read_file", "browser_read"):
                # Search/read results need more context to preserve data
                parts.append(text[:400])
            else:
                parts.append(text[:200])
        elif role == "assistant" and len(text) > 20:
            # Assistant conclusions — keep more of the actual content
            clean = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()
            if clean:
                # Skip tool call blocks, keep the analysis text
                analysis = re.sub(r'```tool\s*\n.*?\n```', '', clean, flags=re.DOTALL).strip()
                if analysis:
                    parts.append(f"[agent] {analysis[:250]}")

    if not parts:
        return f"({len(messages_to_summarize)} previous steps completed)"

    # Cap total summary size — increased from 800 to 1500
    summary = "\n".join(parts)
    if len(summary) > 1500:
        summary = summary[:1500] + "..."
    return summary


def _llm_summarize(engine, messages_to_summarize, original_goal):
    """LLM-based summary. Only used when many messages need summarizing."""
    parts = []
    for m in messages_to_summarize:
        role = m.get("role", "?")
        content = m.get("content", "")
        if isinstance(content, list):
            content = " ".join(str(p.get("text", "")) for p in content if isinstance(p, dict) and p.get("type") == "text")
        text = str(content)[:400]
        parts.append(f"[{role}] {text}")

    history_text = "\n".join(parts)
    if len(history_text) > 2500:
        history_text = history_text[-2500:]

    summary_prompt = [
        {"role": "system", "content": "Summarize progress as bullet points: done, found, remaining. Max 200 words. Vietnamese OK."},
        {"role": "user", "content": f"GOAL: {original_goal}\n\n{history_text}\n\nSummarize:"},
    ]

    summary = ""
    try:
        for chunk in engine.chat_stream(messages=summary_prompt, max_tokens=400, temperature=0.1):
            summary += chunk
        summary = re.sub(r'<think>.*?</think>', '', summary, flags=re.DOTALL).strip()
    except Exception:
        summary = _fast_summarize(messages_to_summarize, original_goal)

    return summary


# After trimming, target this fill ratio so there's room for new tool results
_TRIM_TARGET_RATIO = 0.65  # keep context at 65% after trim — leaves ~35% headroom for new messages
_LLM_SUMMARIZE_THRESHOLD = 12  # only call LLM summary when >12 messages to summarize
_TRIM_COOLDOWN = 5  # skip trim if we trimmed fewer than N iterations ago
_last_trim_iteration = -10  # cooldown tracker: skip trim if we just trimmed

def _trim_messages(messages, limit=8000, original_goal="", engine=None, iteration=-1):
    """Smart context management: summarize old messages + inject scratchpad.

    Uses fast text-based summary by default; only calls LLM when many messages
    need summarizing. Targets 75% fill to avoid retrigger loops.
    """
    global _last_trim_iteration

    if not messages:
        return messages

    total = sum(_estimate_tokens(m.get("content", "")) for m in messages)
    if total <= limit:
        return messages

    # Cooldown: if we trimmed recently, only trim if significantly over limit (>115%)
    if iteration >= 0 and (iteration - _last_trim_iteration) < _TRIM_COOLDOWN and total < limit * 1.15:
        return messages

    logger.info(f"✂️ Context overflow: ~{total} tokens > limit {limit}")
    _last_trim_iteration = iteration

    system_msg = messages[0]
    sys_tokens = _estimate_tokens(system_msg.get("content", ""))

    # Find original user message
    first_user_msg = None
    first_user_idx = -1
    for idx, m in enumerate(messages[1:], 1):
        if m.get("role") == "user":
            first_user_msg = m
            first_user_idx = idx
            break

    if original_goal and not first_user_msg:
        first_user_msg = {"role": "user", "content": original_goal}

    user_tokens = _estimate_tokens(first_user_msg.get("content", "")) if first_user_msg else 0

    # Reserve space for: system + user goal + scratchpad + summary + recent messages
    scratchpad_text = _read_scratchpad()
    # Cap scratchpad to prevent unbounded growth
    if scratchpad_text and len(scratchpad_text) > 1500:
        scratchpad_text = scratchpad_text[-1500:]
    scratchpad_tokens = _estimate_tokens(scratchpad_text) if scratchpad_text else 0
    summary_reserve = 300  # tokens for summary block
    overhead = sys_tokens + user_tokens + scratchpad_tokens + summary_reserve + 100

    if overhead > limit * 0.7:
        sys_content = str(system_msg.get("content", ""))
        max_sys = int(limit * 0.30 * 1.5)
        system_msg = {"role": "system", "content": sys_content[:max_sys]}
        sys_tokens = _estimate_tokens(system_msg.get("content", ""))
        overhead = sys_tokens + user_tokens + scratchpad_tokens + summary_reserve + 100

    target = int(limit * _TRIM_TARGET_RATIO)
    budget = max(500, target - overhead)

    # Split messages into old (to summarize) and recent (to keep)
    remaining = messages[1:]
    if first_user_idx > 0:
        remaining = [m for idx, m in enumerate(messages[1:], 1) if idx != first_user_idx]

    # Keep recent messages that fit in budget
    kept = []
    kept_tokens = 0
    for m in reversed(remaining):
        t = _estimate_tokens(m.get("content", ""))
        if kept_tokens + t <= budget:
            kept.append(m)
            kept_tokens += t
        else:
            break
    kept.reverse()

    old_count = len(remaining) - len(kept)
    old_messages = remaining[:old_count]

    # Generate summary — fast by default, LLM only for large batches
    summary_text = ""
    if old_messages:
        if old_count >= _LLM_SUMMARIZE_THRESHOLD and engine:
            summary_text = _llm_summarize(engine, old_messages, original_goal or "")
            logger.info(f"📝 LLM-summarized {old_count} old messages")
        else:
            summary_text = _fast_summarize(old_messages, original_goal or "")
            logger.info(f"📝 Fast-summarized {old_count} old messages")

    # Build final messages
    result = [system_msg]

    if first_user_msg:
        result.append(first_user_msg)

    # Inject scratchpad + summary as context
    context_parts = []
    if summary_text:
        context_parts.append(f"## PREVIOUS PROGRESS:\n{summary_text}")
    if scratchpad_text:
        context_parts.append(f"## YOUR SCRATCHPAD NOTES:\n{scratchpad_text}")
    if context_parts:
        result.append({"role": "user", "content":
            "[System — Context]\n" + "\n\n".join(context_parts) +
            "\n\nContinue working."})

    result.extend(kept)

    new_tokens = sum(_estimate_tokens(m.get("content", "")) for m in result)
    logger.info(f"✂️ Trimmed to {len(result)} msgs (~{new_tokens} tokens, kept {len(kept)}, summarized {old_count})")
    return result


def _generate_plan_stream(engine, user_message, attachments=None,
                           max_tokens=PLAN_MAX_TOKENS, temperature=0.3):
    """Ask LLM to decompose a complex task into numbered steps. Yields tokens while generating.
    Returns the final plan string as its last yield.
    """
    plan_prompt = f"""Lập kế hoạch thực thi cực kỳ ngắn gọn.
Task: {user_message}

Quy định:
- Nếu đơn giản (chỉ cần 1 tool), trả lời đúng 1 từ: SIMPLE
- Ngược lại, liệt kê các bước đánh số.
- Mỗi bước tương ứng với 1 tool call.
- Định dạng: 1. tool_name: Mô tả ngắn gọn bằng tiếng Việt (không dùng từ ngữ bóng bẩy).
Ví dụ: 1. read_file: Đọc code để phân tích.
"""

    user_content = [{"type": "text", "text": plan_prompt}]
    if attachments:
        for att in attachments:
            name = att.get("name", "file")
            path = att.get("path", "")
            
            # Always mention the file path in text so tools can use it
            info = f"\n\n[Đính kèm: {name}" + (f" tại {path}]" if path else "]")
            user_content[0]["text"] += info
            
            if att.get("type", "").startswith("image"):
                user_content.append({
                    "type": "image_url",
                    "image_url": {"url": att.get("url")}
                })

    plan_messages = [
        {"role": "system", "content": "You are a concise task planner. Output ONLY numbered steps or SIMPLE."},
        {"role": "user", "content": user_content},
    ]

    full_plan = ""
    yielded_think_len = 0
    yielded_text_len = 0

    for chunk in engine.chat_stream(messages=plan_messages, max_tokens=max_tokens, temperature=temperature):
        full_plan += chunk
        
        # Extract thinking vs text deltas (same logic as main run_agent)
        think_matches = re.findall(r'<(?:think|thought)>([\s\S]*?)(?:</(?:think|thought)>|$)', full_plan, re.IGNORECASE)
        current_thinking = "".join(think_matches)
        
        if len(current_thinking) > yielded_think_len:
            delta = current_thinking[yielded_think_len:]
            yield delta, None
            yielded_think_len = len(current_thinking)
        
        # We don't yield the plan text tokens here as 'text' type yet 
        # because the original run_agent logic expects plan_text to be returned in full at the end.
        # But we must ensure the 'final' plan returned is CLEAN.

    # Final cleanup
    # Remove thoughts for the actual plan parsing
    clean_plan = re.sub(r'<(?:think|thought)>.*?</(?:think|thought)>', '', full_plan, flags=re.DOTALL | re.IGNORECASE).strip()
    
    if "SIMPLE" in clean_plan.upper() or clean_plan.count("\n") < 1:
        yield "", ""
    else:
        yield "", clean_plan


def _parse_plan_steps(plan_text: str) -> List[str]:
    """Extract individual steps from a numbered plan."""
    steps = []
    for line in plan_text.strip().split("\n"):
        line = line.strip()
        if re.match(r'^\d+[\.\)]\s', line):
            steps.append(line)
    return steps


def run_agent(user_message, history=None, attachments=None, max_tokens=4096, temperature=0.5, cancel_event=None, session_id=None):
    """Run the agent loop. If cancel_event (threading.Event) is set, stop gracefully."""
    if session_id:
        current_session_id.set(session_id)
    engine = LLMEngine.get()
    if not engine.is_ready:
        yield {"type": "error", "content": "Model not ready"}
        return

    try:
        messages = []  # Initialize to avoid UnboundLocalError in finally block
        def _cancelled():
            return cancel_event is not None and cancel_event.is_set()

        # Clear scratchpad and reset trim state for fresh task
        tool_scratchpad({"action": "clear"})
        global _last_trim_iteration
        _last_trim_iteration = -5
        # Reset URL tracking for fresh cleanup
        # Initialize thread-local browser state for this agent run
        import core.agent_tools as _at
        _at._opened_tabs_var.set([])
        _at._opened_urls_var.set([])



        # ── Phase 1: Planning (workflow-aware) ────────────────────────────────
        plan_steps = []
        is_complex = len(user_message) > PLAN_BYPASS_LENGTH or attachments or any(word in user_message.lower() for word in ["mô tả", "phân tích", "search", "quét", "lọc", "viết", "tạo", "sửa", "deep_search", "giải quyết", "debug", "fix"])
        
        if is_complex:
            yield {"type": "thinking", "content": "Đang phân tích yêu cầu..."}
            plan_text = ""
            for chunk, final in _generate_plan_stream(engine, user_message, attachments=attachments):
                if final is not None:
                    plan_text = final
                else:
                    yield {"type": "thinking_token", "content": chunk}

            plan_steps = _parse_plan_steps(plan_text) if plan_text else []

            if plan_steps:
                plan_display = "📋 KẾ HOẠCH:\n" + "\n".join(plan_steps)
                yield {"type": "text", "content": plan_display}
                logger.info(f"📋 Plan generated: {len(plan_steps)} steps")
            else:
                logger.info("📋 Simple task, no plan needed")
        else:
            logger.info("📋 Short message, skipping planning phase")

        # ── Phase 2: Execution ─────────────────────────────────────────────────
        messages = [{"role": "system", "content": build_system_prompt(user_message, session_id=session_id)}]
        if history: messages.extend(history)

        # Prepare actual multi-modal content for engine
        user_content = [{"type": "text", "text": user_message}]
        if attachments:
            for att in attachments:
                name = att.get("name", "file")
                path = att.get("path", "")
                
                # Always mention the file path in text so tools can use it
                info = f"\n\n[Đính kèm: {name}" + (f" tại {path}]" if path else "]")
                user_content[0]["text"] += info

                if att.get("type", "").startswith("image"):
                    user_content.append({
                        "type": "image_url",
                        "image_url": {"url": att.get("url")}
                    })

        if plan_steps:
            # We must use list format for augmented message too if multimodal
            augmented_text = f"""{user_message}

YOUR PLAN (thực hiện từng bước, không bỏ sót):
{chr(10).join(plan_steps)}

Thực hiện Bước 1 NGAY BÂY GIỜ. Gọi tool."""
            
            # If there was an image, we still want to keep the image part
            if len(user_content) > 1:
                user_msg_final = [{"type": "text", "text": augmented_text}] + user_content[1:]
            else:
                user_msg_final = augmented_text
            
            messages.append({"role": "user", "content": user_msg_final})
        else:
            messages.append({"role": "user", "content": user_content if len(user_content) > 1 else user_message})

        docs_updated = False
        current_step = 0
        continuation_budget = 15   # max consecutive continuations for one response
        continuation_count = 0
        overflow_count = 0  # tracks consecutive context overflow retries
        malformed_count = 0  # tracks consecutive malformed tool call retries

        for i in range(MAX_ITERATIONS):
            if _cancelled():
                logger.info("🛑 Agent cancelled by user")
                yield {"type": "text", "content": "⏹️ Đã dừng."}
                return

            # ── Check for user intervention (injected messages) ──────────────
            try:
                from core.agent_daemon import AgentDaemon
                daemon = AgentDaemon.get()
                injected = daemon.pop_injected_messages(session_id)
                for inj_msg in injected:
                    logger.info(f"💉 Processing injected message: {inj_msg[:80]}")
                    yield {"type": "text", "content": f"📝 **User hướng dẫn:** {inj_msg}"}
                    messages.append({"role": "user", "content":
                        f"[User Intervention] The user just sent this instruction while you are working:\n"
                        f"{inj_msg}\n\n"
                        f"IMPORTANT: Follow this instruction immediately. It overrides your current plan."})
                    # Reset malformed counter — user might be providing correction
                    malformed_count = 0
            except Exception:
                pass  # Daemon not available (e.g. running outside daemon context)

            actual_ctx = MODEL_N_CTX
            # safe_limit = space available for the full conversation (input only)
            # Reserve max_tokens for LLM output + 800 buffer for tool results/guidance
            safe_limit = max(2000, actual_ctx - max_tokens - 800)
            # If we've had context overflow errors, shrink further
            if overflow_count > 0:
                safe_limit = max(1500, safe_limit // (overflow_count + 1))
            messages = _trim_messages(messages, limit=safe_limit, original_goal=user_message, engine=engine, iteration=i)

            # ── Dynamic max_tokens: prevent LLM response from overflowing the context ──
            # After trim, calculate how many tokens are still available for the response.
            # Formula: actual_ctx - current_input_tokens - 600 (tool results headroom)
            current_input_tokens = sum(_estimate_tokens(m.get("content", "")) for m in messages)
            available_for_output = actual_ctx - current_input_tokens - 600
            call_max_tokens = max(512, min(max_tokens, available_for_output))
            if call_max_tokens < max_tokens:
                logger.debug(f"⚡ Dynamic max_tokens: {max_tokens} → {call_max_tokens} (input={current_input_tokens}, ctx={actual_ctx})")

            try:
                resp_buffer = ""
                yielded_think_len = 0
                yielded_text_len = 0
                _initial_phase = True

                for chunk in engine.chat_stream(messages=messages, max_tokens=call_max_tokens, temperature=temperature):
                    if _cancelled():
                        break
                    resp_buffer += chunk

                    # 1. Extract ALL thinking content so far (handles multiple blocks/partial tags)
                    think_matches = re.findall(r'<(?:think|thought)>([\s\S]*?)(?:</(?:think|thought)>|$)', resp_buffer, re.IGNORECASE)
                    current_thinking = "".join(think_matches)
                    
                    # 2. Extract ALL text content so far (strips think blocks)
                    current_text = re.sub(r'<(?:think|thought)>[\s\S]*?(?:</(?:think|thought)>|$)', '', resp_buffer, flags=re.DOTALL | re.IGNORECASE)

                    # Initial phase filtering: buffer until <think> or 50+ chars to avoid leaked tokens
                    if _initial_phase:
                        if "<think" in resp_buffer.lower() or "<thought" in resp_buffer.lower():
                            _initial_phase = False
                        elif len(resp_buffer) >= 50:
                            _initial_phase = False
                        else:
                            continue

                    # Yield Thinking Delta
                    if len(current_thinking) > yielded_think_len:
                        delta = current_thinking[yielded_think_len:]
                        yield {"type": "thinking_token", "content": delta}
                        yielded_think_len = len(current_thinking)
                    
                    # Yield Text Delta (only if not currently ending in a partial tag)
                    if len(current_text) > yielded_text_len:
                        # Don't yield if buffer ends with partial tag to avoid flicker/leak
                        if not any(resp_buffer.lower().endswith(s) for s in ["<", "<t", "<th", "<thi", "<thin", "<think", "<tho", "<thou", "<thoug", "<thought"]):
                             delta = current_text[yielded_text_len:]
                             yield {"type": "text", "content": delta}
                             yielded_text_len = len(current_text)

                resp = resp_buffer
            except Exception as e:
                yield {"type": "error", "content": f"LLM error: {str(e)}"}
                return

            if _cancelled():
                logger.info("🛑 Agent cancelled during LLM stream")
                return

            if not resp:
                break

            # ── Context overflow recovery ─────────────────────────────────────
            if engine._context_overflow or resp.startswith("[CONTEXT_OVERFLOW]"):
                engine._context_overflow = False
                overflow_count += 1
                if overflow_count > 3:
                    yield {"type": "error", "content": "❌ Context quá lớn, không thể tiếp tục sau 3 lần thử."}
                    return
                logger.info(f"⚠️ Context tràn (lần {overflow_count}), đang thu nhỏ và thử lại...")
                logger.warning(f"🔄 Context overflow #{overflow_count}, retrying with reduced context")
                # Trim aggressively right now so next iteration's trim is effective
                messages = _trim_messages(
                    messages,
                    limit=max(1500, safe_limit // (overflow_count + 1)),
                    original_goal=user_message,
                    engine=engine,
                    iteration=i,
                )
                continue
            else:
                overflow_count = 0  # reset on successful call

            # ── Token-limit continuation ──────────────────────────────────────
            finish_reason = engine._last_finish_reason
            if _is_truncated(resp, finish_reason) and continuation_count < continuation_budget:
                continuation_count += 1
                yield {"type": "text", "content": f"⏩ [Đang tiếp tục... phần {continuation_count}]"}
                logger.info(f"🔁 Continuation {continuation_count} (finish_reason={finish_reason})")
                # Append what we have, ask to continue
                messages.append({"role": "assistant", "content": resp})
                messages.append({"role": "user", "content":
                    "[System] Your response was cut off. Continue EXACTLY from where you stopped. "
                    "Do NOT restart or repeat. Just continue the unfinished output."})
                continue
            else:
                continuation_count = 0  # reset on clean response

            # ── Parse thinking / clean response ──────────────────────────────
            # Dùng findall để lấy TẤT CẢ nội dung thinking (tránh bị cắt ngắn do non-greedy)
            thinking_parts = [p.strip() for p in re.findall(r'<(?:think|thought)>(.*?)</(?:think|thought)>', resp, re.DOTALL) if p.strip()]
            if thinking_parts:
                # Nối thông minh: nếu đoạn ngắn hoặc không kết thúc bằng dấu câu -> nối bằng dấu cách, tránh rớt dòng
                full_thinking = ""
                for part in thinking_parts:
                    if not full_thinking:
                        full_thinking = part
                    else:
                        # Nếu phần tước đó ngắn hoặc không có dấu câu -> nối bằng dấu cách
                        if len(full_thinking) < 50 or not re.search(r'[.!?]$', full_thinking.strip()) or len(part) < 50:
                            full_thinking = full_thinking.rstrip() + " " + part
                        else:
                            full_thinking = full_thinking.rstrip() + "\n\n" + part
                
                # Logic for full_thinking omitted here to avoid redundancy with thinking_tokens
                # yield {"type": "thinking", "content": full_thinking}
                # Xóa tất cả thẻ thinking khỏi response
                clean = re.sub(r'<(?:think|thought)>.*?</(?:think|thought)>', '', resp, flags=re.DOTALL).strip()
            else:
                clean = resp.strip()

            t_calls = _parse_tool_calls(clean)

            if t_calls:
                malformed_count = 0  # reset on successful parse
                # No need to yield 'pre' text here because it was already yielded as deltas during chat_stream

                messages.append({"role": "assistant", "content": resp})
                results_text = []
                vision_blocks = []

                # ── Classify tools: sequential (UI/browser) vs parallelizable ──
                _SEQUENTIAL_TOOLS = frozenset({
                    "browser_go", "browser_click", "browser_type", "browser_read",
                    "browser_scroll", "browser_close", "open_browser",
                    "sys_click", "sys_key", "sys_type", "sys_open_app",
                    "sys_get_active_app", "screenshot", "fb_message",
                    "write_file", "tool_scratchpad", "update_docs",
                })

                # Filter out duplicate update_docs
                active_calls = [(t, a) for t, a in t_calls if not (t == "update_docs" and docs_updated)]

                # Check if we can parallelize: all tools must be non-sequential
                can_parallel = (
                    len(active_calls) > 1
                    and all(t not in _SEQUENTIAL_TOOLS for t, _ in active_calls)
                )

                if can_parallel:
                    # ── Parallel execution with ThreadPoolExecutor ──
                    for tname, targs in active_calls:
                        yield {"type": "tool_call", "tool": tname, "args": targs}

                    tool_results_ordered = [None] * len(active_calls)
                    with ThreadPoolExecutor(max_workers=min(len(active_calls), 6)) as pool:
                        future_to_idx = {
                            pool.submit(execute_tool, tname, targs): idx
                            for idx, (tname, targs) in enumerate(active_calls)
                        }
                        for future in as_completed(future_to_idx):
                            idx = future_to_idx[future]
                            try:
                                tool_results_ordered[idx] = future.result()
                            except Exception as e:
                                tool_results_ordered[idx] = {"error": str(e)}

                    # Process results in original order
                    for idx, (tname, targs) in enumerate(active_calls):
                        res = tool_results_ordered[idx]
                        yield {"type": "tool_result", "tool": tname, "result": res}
                        res, res_txt = _process_tool_result(tname, res, vision_blocks)
                        results_text.append(f"[{tname}]: {res_txt}")
                        if tname == "update_docs":
                            docs_updated = True
                else:
                    # ── Sequential execution (UI tools or single call) ──
                    for tname, targs in active_calls:
                        yield {"type": "tool_call", "tool": tname, "args": targs}
                        res = execute_tool(tname, targs)
                        yield {"type": "tool_result", "tool": tname, "result": res}
                        res, res_txt = _process_tool_result(tname, res, vision_blocks)
                        results_text.append(f"[{tname}]: {res_txt}")
                        if tname == "update_docs":
                            docs_updated = True

                current_step += 1
                has_error = any("error" in r.lower() or "failed" in r.lower() for r in results_text)

                # Guidance after tool execution
                is_search_tool = any(t in ("deep_search", "web_search", "read_web") for t, _ in t_calls)
                if has_error:
                    guidance = "Tool returned an error. Analyze what went wrong and try a different approach."
                elif is_search_tool:
                    guidance = (
                        "Search results received. READ the content carefully. "
                        "Extract EXACT data (numbers, prices, dates) from the sources above. "
                        "Do NOT fabricate or estimate — quote precisely what the sources say. "
                        "Include source URLs in your response. Reply in Vietnamese."
                    )
                else:
                    active_info = ""
                    if any(t.startswith("sys_") or t.startswith("browser_") for t, _ in t_calls):
                         active_info = " If you just switched or used an app, mention exactly which app is now in focus."
                    
                    if plan_steps and current_step < len(plan_steps):
                        guidance = f"Step {current_step}/{len(plan_steps)} done. NEXT: {plan_steps[current_step]}.{active_info}"
                    elif plan_steps and current_step >= len(plan_steps):
                        guidance = f"All steps done. Summarize results in Vietnamese with key findings.{active_info}"
                    else:
                        guidance = f"Continue with next action, or summarize if the task is complete.{active_info}"

                combined_text = "\n".join(results_text) + f"\n{guidance}"

                if vision_blocks:
                    messages.append({"role": "user", "content": [{"type": "text", "text": combined_text}] + vision_blocks})
                else:
                    messages.append({"role": "user", "content": combined_text})

            else:
                # Malformed JSON — retry with limit
                looks_like_tool = ("```" in clean or '"tool"' in clean or "'tool'" in clean or "{" in clean) and len(clean) > 30
                if looks_like_tool:
                    malformed_count += 1

                    if malformed_count > 2:
                        # After 2 failures, try to extract intent and execute directly
                        auto_tool = _auto_fix_tool_call(clean)
                        if not auto_tool:
                            # Auto-fix from clean text failed. Try extracting from user's original message.
                            auto_tool = _auto_fix_tool_call(user_message)
                        if not auto_tool:
                            # Last resort: use the suggested tool for this task type
                            example_json = _suggest_tool_for_task(user_message, plan_steps, current_step)
                            try:
                                example_data = json.loads(example_json)
                                if "tool" in example_data:
                                    auto_tool = (example_data["tool"], example_data.get("args", {}))
                            except Exception:
                                pass

                        if auto_tool:
                            tname, targs = auto_tool
                            # Validate: skip if args are placeholder text
                            is_placeholder = any(v in str(targs) for v in ["Tên người", "/path/to", "example search"])
                            if not is_placeholder:
                                logger.info(f"🔧 Auto-executing tool from intent: {tname}({targs})")
                                yield {"type": "tool_call", "tool": tname, "args": targs}
                                res = execute_tool(tname, targs)
                                yield {"type": "tool_result", "tool": tname, "result": res}
                                res_txt = json.dumps(res, ensure_ascii=False, default=str)[:2000]
                                messages.append({"role": "assistant", "content": resp})
                                messages.append({"role": "user", "content": f"[{tname}]: {res_txt}\nContinue with the next step."})
                                current_step += 1
                                malformed_count = 0
                                continue

                        # All auto-fix attempts failed — give model one final chance with a very explicit example
                        yield {"type": "error", "content": "⚠️ Không parse được tool call. Đang hướng dẫn lại..."}
                        example = _suggest_tool_for_task(user_message, plan_steps, current_step)
                        messages.append({"role": "assistant", "content": resp})
                        messages.append({"role": "user", "content":
                            f"[System] Your tool call format was wrong. Copy this EXACTLY:\n"
                            f"```tool\n{example}\n```\n"
                            f"Output ONLY the code block above. Nothing else."})
                        malformed_count = 0
                        continue

                    # Remove previous failed attempts to avoid context pollution
                    # (keep only the last 2 assistant+user pairs to avoid infinite growth)
                    messages.append({"role": "assistant", "content": resp})
                    messages.append({"role": "user", "content":
                        f'[System] Tool call could not be parsed (attempt {malformed_count}/2). '
                        f'You MUST use this EXACT format — one JSON object inside a tool code block:\n'
                        f'```tool\n'
                        f'{{"tool": "sys_open_app", "args": {{"app_name": "Brave Browser"}}}}\n'
                        f'```\n'
                        f'Output ONLY the code block, no extra text around it. Try now.'})
                    logger.info(f"⚠️ Malformed tool call (retry {malformed_count}), retrying...")
                    continue

                # Reset malformed counter on non-tool responses
                malformed_count = 0

                DONE_SIGNALS = [
                    "hoàn thành", "đã xong", "đã hoàn tất", "tổng kết", "kết quả",
                    "done", "completed", "finished", "summary", "all done",
                    "task complete", "successfully completed",
                    "chào", "chào bạn", "xin chào", "tạm biệt", "vâng", "được rồi",
                    "đã mở", "đã chạy", "đã thực hiện", "thành công"
                ]
                # Refusal signals — model claims it can't do something. Must override.
                REFUSAL_SIGNALS = [
                    "i cannot", "i can't", "không thể", "tôi không có khả năng",
                    "my limitations", "i don't have", "i am unable",
                    "ngoài khả năng", "không có quyền truy cập",
                    "no internet", "no browsing", "cannot access",
                ]

                clean_lower = clean.lower()
                is_final_signal = any(sig in clean_lower for sig in DONE_SIGNALS)
                is_refusal = any(sig in clean_lower for sig in REFUSAL_SIGNALS)
                has_pending_steps = plan_steps and current_step < len(plan_steps)

                # Forced Auto-Continue if signal says done but plan is NOT done
                if is_final_signal and has_pending_steps:
                    logger.warning(f"🔄 Hallucinated completion at step {current_step+1}/{len(plan_steps)}. Forcing continuation.")
                    yield {"type": "text", "content": "⚠️ Chưa hoàn thành mọi bước, đang yêu cầu Agent tiếp tục..."}
                    messages.append({"role": "assistant", "content": resp})
                    messages.append({"role": "user", "content": f"[System Override] You claimed to be finished, but you have NOT completed step {current_step+1}: {plan_steps[current_step]}. Continue with the code/task NOW. Do NOT summarize yet."})
                    continue

                if is_refusal and current_step == 0:
                    yield {"type": "text", "content": "⚠️ Model từ chối sai — đang hướng dẫn lại..."}
                    example = _suggest_tool_for_task(user_message, plan_steps, current_step)
                    messages.append({"role": "assistant", "content": resp})
                    messages.append({"role": "user", "content": f"[System] You DO have tools (browser, system, search). Do NOT refuse. Use your tools NOW.\nExample:\n```tool\n{example}\n```"})
                    continue

                # No need to yield 'clean' here because it was already yielded as deltas during chat_stream
                # if clean:
                #     yield {"type": "text", "content": clean}

                # Comprehensive completion check
                
                # 1. If the agent provided a response without calling tools, and no steps are pending,
                # we consider the task complete. No need to nag it for a 'final signal'.
                if not t_calls and not has_pending_steps:
                    logger.info("✅ Agent finished responding (no tools called). Yielding done.")
                    yield {"type": "done"}
                    return

                # 2. Fallback signal check
                is_actually_done = (is_final_signal or not plan_steps) and not has_pending_steps
                if is_actually_done and (clean or not plan_steps):
                    yield {"type": "done"}
                    return
                else:
                    # CONVERSATIONAL CHECK: If no tools were used and no plan exists,
                    # it was probably a conversational turn. Stop now to avoid loops.
                    if not plan_steps and not t_calls:
                        logger.info("💬 Conversational turn finished. Yielding done.")
                        yield {"type": "done"}
                        return

                    # SMART NUDGE: If the last message in history is a 'tool' result,
                    # we don't need a heavy "[System]" nudge, just a simple continuation.
                    is_last_tool = messages and messages[-1].get("role") == "tool"
                    
                    if has_pending_steps:
                        nudge = f"[System] Step {current_step}/{len(plan_steps)} result received. Proceed to Step {current_step+1}: {plan_steps[current_step]}."
                    elif is_last_tool:
                        # If we just got a tool result but no plan, just ask for the next logical step OR summary.
                        nudge = "[System] Result received. Continue to next action or provide final summary in Vietnamese."
                    else:
                        nudge = "[System] Task appears incomplete. If finished, provide final summary in Vietnamese. If not, continue the logic flow."
                    
                    logger.info(f"⏩ Auto-nudging agent... (pending={has_pending_steps}, last_is_tool={is_last_tool})")
                    if resp.strip():
                        messages.append({"role": "assistant", "content": resp})
                    messages.append({"role": "user", "content": nudge})
                    continue

    except Exception as e:
        import traceback
        logger.error(f"❌ Fatal error: {e}\n{traceback.format_exc()}")
        yield {"type": "error", "content": f"Fatal transition error: {e}"}
    finally:
        # ── Phase 3: Cleanup ───────────────────────────────────────────
        logger.info("🏁 Agent task finished. Starting browser cleanup...")
        try:
            res = cleanup_agent_browser_tabs()
            logger.info(f"💾 Cleanup result: {res}")
        except Exception as e:
            logger.error(f"⚠️ Global cleanup failed: {e}")
        
        # Trigger self-learning in background
        try:
            from core.learner import trigger_learning
            trigger_learning(messages)
        except Exception as e:
            logger.error(f"⚠️ Learning failed: {e}")

def stringify_agent_event(event: Dict[str, Any]) -> str:
    """Pack an AgentExecutor event into a string format that the frontend can parse as historical events."""
    etype = event.get("type")
    
    if etype == "thinking":
        content = event.get('content', '').strip()
        if not content: return ""
        return f"\n<think>\n{content}\n</think>\n"
    elif etype == "thinking_token":
        content = event.get("content", "")
        # Use regex for robust, case-insensitive tag removal
        return re.sub(r'<\/?(?:think|thought)>', '', content, flags=re.IGNORECASE)
    elif etype == "tool_call":
        tool = event.get("tool", "unknown")
        # Ensure arguments are treated as a dict
        args_obj = event.get("args", {})
        if isinstance(args_obj, str):
            # Try to fix "loose" string args
            try: args_obj = json.loads(args_obj)
            except: args_obj = {"raw": args_obj}
        
        args_str = json.dumps(args_obj, ensure_ascii=False)
        return f"\n<tool>\n{{\"tool\": \"{tool}\", \"args\": {args_str}}}\n</tool>\n"
    elif etype == "tool_result":
        tool = event.get("tool", "unknown")
        result = event.get("result", "")
        if isinstance(result, dict):
            # Strip massive base64 image data — only keep path/metadata
            clean = {k: v for k, v in result.items()
                     if k not in ("base64", "_frontend_screenshot", "_frontend_screenshot_path")
                     and not (isinstance(v, str) and len(v) > 500 and v[:20].replace('+', '').replace('/', '').replace('=', '').isalnum())}
            result_str = json.dumps(clean, ensure_ascii=False, default=str)
        elif isinstance(result, list):
            result_str = json.dumps(result, ensure_ascii=False, default=str)
        else:
            result_str = str(result)
            
        # Truncate extremely long results to prevent DB/Frontend bloat
        if len(result_str) > 4000:
            result_str = result_str[:4000] + "... [truncated]"
        return f"\n📤 **Result ({tool})**: {result_str}\n"
    elif etype == "screenshot":
        path = event.get("path", "")
        return f"\n📸 Screenshot: {path}\n"
    elif etype == "text":
        return event.get("content", "")
    elif etype == "error":
        return f"\n❌ **Error**: {event.get('content', '')}\n"
    
    return ""
