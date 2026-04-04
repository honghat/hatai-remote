"""
AI Agent Tools — callable tools for the agent loop.
Each tool takes a dict of args and returns a dict of results.
"""
import os
import re
import subprocess
import base64
import datetime
import logging
import contextvars
from typing import Dict, Any

from core.office_tools import OFFICE_TOOLS, OFFICE_TOOL_DEFINITIONS

logger = logging.getLogger("AgentTools")

# ── Context-local Thread State ──────────────────────────────────────────────
# When running multiple agents in parallel, these vars ensure they don't
# fight over browser focus or clean up each other's tabs.
_active_browser_var = contextvars.ContextVar("active_browser", default="Google Chrome")
_opened_tabs_var = contextvars.ContextVar("opened_tabs", default=None)
_opened_urls_var = contextvars.ContextVar("opened_urls", default=None)

def _get_active_browser(): return _active_browser_var.get()
def _set_active_browser(val): _active_browser_var.set(val)

def _get_tabs():
    val = _opened_tabs_var.get()
    if val is None:
        val = []
        _opened_tabs_var.set(val)
    return val

def _get_urls():
    val = _opened_urls_var.get()
    if val is None:
        val = []
        _opened_urls_var.set(val)
    return val

# Security: only allow paths under these dirs
ALLOWED_PATHS = ["/Users/nguyenhat", "/Volumes/HatAI", "/tmp"]


def _check_path(path: str) -> bool:
    abs_path = os.path.realpath(path)
    return any(abs_path.startswith(os.path.realpath(b)) for b in ALLOWED_PATHS)


SCREENSHOT_DIR = "/tmp/hatai_screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)
_agent_opened_tabs = [] # List of (browser_name, tab_id) tuples to cleanup later
_agent_opened_urls = [] # List of URLs opened by agent — used for cleanup by domain match
_last_browser = "Google Chrome"

# ── URL → Browser routing ──────────────────────────────────────────────────
# Certain sites are routed to specific browsers automatically.
# Everything else uses _last_browser (default: Chrome).
_BROWSER_ROUTING = {
    "youtube.com": "Brave Browser",
    "youtu.be": "Brave Browser",
}

# Tracks the browser used in the most recent navigation (browser_go/open_browser).
_active_browser = "Google Chrome"

def _resolve_browser(url: str = "", explicit_browser: str = "") -> str:
    """Pick the right browser for a URL.

    Priority:
    1. Explicit browser arg from the tool call (user/agent chose it)
    2. URL-based routing (_BROWSER_ROUTING table)
    3. _active_browser (the browser from the most recent navigation)
    """
    global _active_browser

    if explicit_browser:
        _active_browser = explicit_browser
        return explicit_browser

    if url:
        url_lower = url.lower()
        for pattern, browser in _BROWSER_ROUTING.items():
            if pattern in url_lower:
                _active_browser = browser
                return browser

    return _active_browser


def _get_session_topic() -> str:
    """Get a unique topic name for the current chat session."""
    from core.agent_executor import current_session_id
    sid = current_session_id.get(None)
    if not sid:
        return "temp_working_memory"
    return f"session_{sid}"


def _auto_index_content(content: str, source: str, topic: str = None) -> str:
    """Automatically index large content into the session-specific RAG.
    Returns a status message on success, or empty string on failure.
    Ensures transient data (news, prices) ONLY goes to temporary session memory.
    """
    if not content or len(content) < 500: # Only index substantial content
        return ""
        
    if not topic:
        topic = _get_session_topic()
        
    # 🏷️ Session Tags for transient data
    is_transient = any(kw in content[:2000].lower() for kw in ["giá vàng", "gold price", "chứng khoán", "tin tức"])
    
    try:
        from core.memory import MemoryManager
        MemoryManager.get().add_knowledge(topic, content, source=source)
        msg = f"✅ Indexed {len(content)} chars into SESSION memory ({topic}) from {source}"
        if is_transient:
            msg += " (Transient data - will be cleared)"
            
        logger.info(f"🧠 {msg}")
        return msg
    except Exception as e:
        logger.error(f"❌ Failed to auto-index: {e}")
        return ""




# ── Tool Definitions (for the LLM prompt) ──────────────────────────────────

TOOL_DEFINITIONS = """
FILE: run_command{command,cwd?} | read_file{path,start_line?,end_line?} → supports line ranges for precise reading | write_file{path,content} | edit_file{path,old_text,new_text} | multi_edit_file{path,edits:[{old_text,new_text},...]} → multiple edits at once | replace_lines{path,start_line,end_line,new_text} | list_dir{path} | search_code{query,path,include?} | find_files{pattern,path} | project_tree{path?,depth?} → show project structure
GIT: git_ops{action,cwd?,message?,file?,branch?,target?,n?,staged?} → actions: status|diff|log|commit|push|pull|branch|stash|checkout
DOCS: analyze_document{path,focus?}
SEARCH: deep_search{query,max_results?} → ALWAYS use this for any search/research request. Searches Google, crawls every result link, extracts full content, returns everything for you to summarize.
BROWSER: browser_go{url} | open_browser{url} | browser_close_tab{which?,url?} | browser_read{} | browser_click{selector} | browser_type{selector,text} | browser_js{script} | browser_wait{seconds?} | browser_extract{selector,attribute?} | browser_extract_prices{} | site_search{site,query}
DESKTOP: screenshot{} | sys_mouse{x,y,action?,amount?,drag_to_x?,drag_to_y?} | sys_type{text,app?,telex?} → telex=true for Vietnamese Telex IME | sys_key{key,modifiers?,app?} | sys_open_app{app_name} | sys_get_active_app{} | sys_stats{} → Get macOS CPU/Memory stats
AI_CODING: claude_code{action,prompt,cwd?,path?,instruction?,focus?,model?} → prompt|edit|review
AI_CODING: antigravity{action,path?,code?,filename?,instruction?,ext_id?,command?,cwd?} → actions: open_file|open_folder|new_file(requires code)|diff|goto|run_terminal|ai_edit(instruction required)|ai_inline|list_extensions|install_extension|uninstall_extension
MEMORY: scratchpad{action,content?} | remember{content,type,topic?} | query_knowledge{topic,query} | add_knowledge{topic,content} | session_query{query,n?} → Smart query: searches session data first, then global knowledge if session is empty. Use this for ANY knowledge lookup.
SOCIAL: fb_message{contact,message}
OTHER: web_search{query} | read_web{url} | get_current_time{} | excel_python{script} | create_background_task{prompt} | delete_all_tasks{}
""" + OFFICE_TOOL_DEFINITIONS


def tool_sys_open_app(args: Dict[str, Any]) -> Dict[str, Any]:
    """Open a macOS application by name."""
    global _last_browser, _active_browser
    app_name = args.get("app_name") or ""
    if not app_name:
        return {"error": "app_name is required"}

    # Common mappings for user-friendly names
    aliases = {
        "brave": "Brave Browser",
        "chrome": "Google Chrome",
        "excel": "Microsoft Excel",
        "word": "Microsoft Word",
        "powerpoint": "Microsoft PowerPoint",
        "vsc": "Visual Studio Code",
        "vscode": "Visual Studio Code"
    }

    target = aliases.get(app_name.lower(), app_name)
    logger.info(f"🚀 Opening App: {target}")

    try:
        subprocess.run(["open", "-a", target], check=True, capture_output=True)
        # Update browser tracking if it's a browser
        if any(b.lower() in target.lower() for b in ["chrome", "brave", "safari", "firefox", "edge"]):
            _last_browser = target
            _active_browser = target
        return {"message": f"Successfully opened {target}"}
    except Exception as e:
        # If specific name fails, try a fuzzy match via mdfind
        try:
            res = subprocess.run(["mdfind", f"kMDItemContentType == 'com.apple.application-bundle' && kMDItemDisplayName == '*{app_name}*'"], capture_output=True, text=True)
            paths = [p for p in res.stdout.split("\n") if p.endswith(".app")]
            if paths:
                subprocess.run(["open", paths[0]], check=True)
                # Update browser tracking if it looks like a browser
                if any(b.lower() in paths[0].lower() for b in ["chrome", "brave", "safari", "firefox", "edge"]):
                    _last_browser = paths[0].split("/")[-1].replace(".app", "")
                    _active_browser = _last_browser
                return {"message": f"Opened {paths[0]}"}
        except:
            pass
        return {"error": f"Failed to open app {target}: {str(e)}"}


# ── Tool Implementations ───────────────────────────────────────────────────

def tool_run_command(args: Dict[str, Any]) -> Dict[str, Any]:
    cmd = args.get("command") or ""
    cwd = args.get("cwd") or os.path.expanduser("~")

    # If cwd is not allowed, just use home dir (don't block the command)
    if not _check_path(cwd):
        cwd = os.path.expanduser("~")

    logger.info(f"🖥️ Running: {cmd} (cwd: {cwd})")
    try:
        # Inherit parent env with full PATH for macOS tools
        env = os.environ.copy()
        # Ensure common macOS paths are included
        extra_paths = [
            "/usr/local/bin", "/usr/bin", "/bin",
            "/usr/sbin", "/sbin",
            "/opt/homebrew/bin", "/opt/homebrew/sbin",
            "/opt/homebrew/opt/postgresql@16/bin",
        ]
        existing = env.get("PATH", "")
        for p in extra_paths:
            if p not in existing:
                existing = p + ":" + existing
        env["PATH"] = existing

        result = subprocess.run(
            cmd, shell=True, cwd=cwd,
            capture_output=True, text=True, timeout=60,
            env=env,
        )
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        # If both empty, note that explicitly
        if not stdout and not stderr and result.returncode == 0:
            stdout = "(no output)"

        return {
            "stdout": stdout[:8000],
            "stderr": stderr[:4000],
            "exit_code": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out (60s)", "exit_code": -1}
    except Exception as e:
        return {"error": str(e), "exit_code": -1}

def tool_sys_stats(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get detailed system statistics for macOS (CPU, Memory, Disk)."""
    logger.info("📊 Gathering system statistics...")
    
    try:
        # 1. Total Physical Memory
        hw_mem_res = subprocess.check_output(["sysctl", "-n", "hw.memsize"]).strip()
        hw_mem = int(hw_mem_res)
        total_gb = round(hw_mem / (1024**3), 1)
        
        # 2. Virtual Memory Stats (via vm_stat)
        vm_stat_raw = subprocess.check_output(["vm_stat"]).decode("utf-8")
        # Page size (usually 4K or 16K)
        ps_match = re.search(r"page size of (\d+) bytes", vm_stat_raw)
        page_size = int(ps_match.group(1)) if ps_match else 4096
        
        vm_data = {}
        for line in vm_stat_raw.split('\n'):
            if ':' in line:
                k, v = line.split(':')
                vm_data[k.strip()] = int(v.strip().rstrip('.')) * page_size
        
        # Key categories as Activity Monitor shows
        wired = vm_data.get("Pages wired down", 0)
        active = vm_data.get("Pages active", 0)
        inactive = vm_data.get("Pages inactive", 0)
        free = vm_data.get("Pages free", 0)
        compressed = vm_data.get("Pages occupied by compressor", 0)
        
        # 3. CPU Usage (via top summary)
        top_res = subprocess.run(["top", "-l", "1", "-n", "0"], capture_output=True, text=True, timeout=5)
        cpu_usage = "Unknown"
        load_avg = "Unknown"
        
        if top_res.returncode == 0:
            cpu_m = re.search(r"CPU usage:\s*(.*)", top_res.stdout)
            if cpu_m: cpu_usage = cpu_m.group(1).strip()
            load_m = re.search(r"Load Avg:\s*(.*)", top_res.stdout)
            if load_m: load_avg = load_m.group(1).strip()

        # 4. Disk Usage (Free space on system root)
        df_res = subprocess.run(["df", "-h", "/"], capture_output=True, text=True, timeout=2)
        disk_info = {}
        if df_res.returncode == 0:
            lines = df_res.stdout.strip().split('\n')
            if len(lines) > 1:
                parts = re.split(r'\s+', lines[1])
                if len(parts) >= 4:
                    disk_info = {"total": parts[1], "used": parts[2], "free": parts[3], "percent": parts[4]}

        return {
            "memory": {
                "total": f"{total_gb} GB",
                "wired": f"{round(wired/(1024**2), 0)} MB",
                "active": f"{round(active/(1024**2), 0)} MB",
                "inactive": f"{round(inactive/(1024**2), 0)} MB",
                "free": f"{round(free/(1024**2), 0)} MB",
                "compressed": f"{round(compressed/(1024**2), 0)} MB",
                "page_size": f"{page_size} bytes"
            },
            "cpu": {
                "usage": cpu_usage,
                "load_avg": load_avg
            },
            "disk": disk_info,
            "platform": "macOS",
            "message": "✅ System statistics retrieved successfully."
        }
    except Exception as e:
        return {"error": f"Failed to retrieve stats: {str(e)}"}


def _resolve_relative_path(path: str) -> str:
    """Resolve a path relative to the current working directory if it's not absolute."""
    if not path:
        return ""
    if os.path.isabs(path):
        return path
    return os.path.abspath(os.path.join(os.getcwd(), path))

def tool_read_file(args: Dict[str, Any]) -> Dict[str, Any]:
    path = args.get("path") or ""
    path = _resolve_relative_path(path)
    if not _check_path(path):
        return {"error": f"Path not allowed: {path}"}
    if not os.path.isfile(path):
        return {"error": f"File not found: {path} (Current Working Directory: {os.getcwd()})"}

    ext = path.lower().split(".")[-1]
    
    # ── Block Images ─────────────────
    if ext in ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic"]:
        return {"error": f"❌ Lỗi: {ext.upper()} là định dạng hình ảnh. Để phân tích tệp này, hãy sử dụng chính năng lực 'THỊ GIÁC' (Vision) của bạn trong <thought> hoặc dùng tool 'analyze_document'."}

    try:
        # ── PDF Support ──────────────────
        if ext == "pdf":
            from pypdf import PdfReader
            reader = PdfReader(path)
            content_parts = []
            for i, page in enumerate(reader.pages):
                content_parts.append(f"--- PAGE {i+1} ---\n{page.extract_text()}")
            content = "\n\n".join(content_parts)
            
        # ── Excel Support ────────────────
        elif ext in ["xlsx", "xls", "csv"]:
            import pandas as pd
            if ext == "csv":
                df = pd.read_csv(path)
            else:
                df = pd.read_excel(path)
            # Use to_markdown for table-like representation
            content = f"### Data from {os.path.basename(path)} ###\n\n"
            content += df.to_markdown(index=False)
            
        # ── Word Support ─────────────────
        elif ext in ["docx"]:
            from docx import Document
            doc = Document(path)
            content = "\n".join([p.text for p in doc.paragraphs])
            
        # ── Default Text Support ─────────
        else:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                all_lines = f.readlines()

            total_lines = len(all_lines)
            start_line = args.get("start_line")
            end_line = args.get("end_line")

            # Support line range reading (1-indexed, inclusive)
            if start_line or end_line:
                s = max(1, int(start_line or 1)) - 1
                e = min(total_lines, int(end_line or total_lines))
                selected = all_lines[s:e]
                numbered = []
                for i, line in enumerate(selected, start=s + 1):
                    numbered.append(f"{i:4d} | {line.rstrip()}")
                content = "\n".join(numbered)
                return {
                    "content": content,
                    "path": path,
                    "type": ext,
                    "total_lines": total_lines,
                    "showing": f"lines {s+1}-{e} of {total_lines}",
                }
            else:
                content = "".join(all_lines)
                # For code files, add total_lines info
                extra = {"total_lines": total_lines} if total_lines > 0 else {}

        # Truncate very large files (30k chars for docs, it's safer)
        # Skip truncation if requested by analyze_document
        no_truncate = args.get("no_truncate", False)
        if not no_truncate and len(content) > 30000:
            content = content[:30000] + f"\n\n... [truncated, total {len(content)} chars]"

        result = {"content": content, "path": path, "type": ext}
        if 'extra' in dir() and extra:
            result.update(extra)
        return result
        
    except Exception as e:
        logger.error(f"Error reading file {path}: {e}")
        return {"error": f"Lỗi xử lý file {ext.upper()}: {str(e)}"}


def tool_analyze_document(args: Dict[str, Any]) -> Dict[str, Any]:
    """Deep multi-pass analysis (MapReduce style) for complex/long documents.
    Best for financial reports, long PDF/Word/Excel files.
    """
    path = args.get("path") or ""
    focus = args.get("focus") or "general analysis (revenue, profit, trend, risk)"
    
    # Check model readiness FIRST
    from core.llm_engine import LLMEngine
    engine = LLMEngine.get()
    if not engine.is_ready:
        return {"error": f"Lỗi: Mô hình ngôn ngữ ({engine.provider}) chưa sẵn sàng để phân tích. Hãy kiểm tra trạng thái AI."}

    # 1. Read the full content (NO truncation)
    read_res = tool_read_file({"path": path, "no_truncate": True})
    if "error" in read_res:
        return read_res
        
    full_content = read_res.get("content", "")
    ext = read_res.get("type", "txt")
    
    # 2. Chunking strategy
    chunks = []
    if ext == "pdf":
        # Robust split for PDF pages
        import re
        chunks = re.split(r"--- PAGE \d+ ---", full_content)
        chunks = [c.strip() for c in chunks if c.strip()]
    else:
        # Simple character chunking for flow text
        chunk_size = 6000
        for i in range(0, len(full_content), chunk_size):
            chunks.append(full_content[i:i + chunk_size])
            
    if not chunks:
        return {"error": "Tài liệu trống hoặc không có nội dung để phân tích."}
        
    logger.info(f"📊 Starting Multi-pass Analysis for {path}: {len(chunks)} chunks.")
    
    from core.llm_engine import LLMEngine
    engine = LLMEngine.get()
    
    # 3. Map Phase: Analyze each chunk
    intermediate_insights = []
    
    for i, chunk in enumerate(chunks):
        logger.info(f"  🧠 Analyzing chunk {i+1}/{len(chunks)}...")
        
        # We use a specialized "Analyst" prompt for the segment
        system_msg = "Bạn là một chuyên gia phân tích dữ liệu và tài chính cấp cao. Nhiệm vụ của bạn là trích xuất insight giá trị từ đoạn văn bản được cung cấp."
        user_msg = f"""Hãy phân tích đoạn tài liệu sau đây ({i+1}/{len(chunks)}) với trọng tâm vào: {focus}.
            
            Yêu cầu:
            - Trích xuất dữ liệu quan trọng (số liệu, doanh thu, lợi nhuận nếu có).
            - Phát hiện xu hướng hoặc sự thay đổi.
            - Chỉ ra các rủi ro hoặc điểm yếu tiềm tàng.
            - Đưa ra nhận xét ngắn gọn (dưới 100 từ).

            ĐOẠN TRÍCH:
            {chunk}
            """
            
        messages = [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg}
        ]
        
        # Call LLM sync (since we're in a tool thread)
        insight = engine.chat_sync(messages, max_tokens=1024, temperature=0.3)
        intermediate_insights.append({
            "chunk": i + 1,
            "insight": insight
        })
        
    # 4. Reduce Phase: Synthesize Global Insight
    logger.info("  🔄 Synthesizing global report from all chunks...")
    
    all_insights_text = "\n\n".join([f"PHẦN {item['chunk']}:\n{item['insight']}" for item in intermediate_insights])
    
    # Auto-index everything for session memory
    idx_msg = _auto_index_content(full_content, source=f"document:{path}")
    _auto_index_content(all_insights_text, source=f"analysis_insights:{path}")

    reduce_system_msg = "Bạn là Giám đốc phân tích (Chief Analyst). Nhiệm vụ của bạn là tổng hợp các insight rời rạc thành một báo cáo chiến lược hoàn chỉnh."
    reduce_user_msg = f"""Dựa trên các phân tích từng phần sau đây của tài liệu '{os.path.basename(path)}', hãy viết một BÁO CÁO TỔNG HỢP hoàn chỉnh.
        
        Cấu trúc báo cáo yêu cầu:
        1. 📊 TỔNG QUAN: Tóm tắt ngắn gọn tình hình hiện tại.
        2. 📈 ĐIỂM SÁNG & TĂNG TRƯỞNG: Các số liệu tích cực và tiềm năng.
        3. ⚠️ RỦI RO & THÁCH THỨC: Các vấn đề cần lưu ý hoặc nguy hiểm.
        4. 💡 NHẬN ĐỊNH CHIẾN LƯỢC: Đưa ra lời khuyên hoặc hướng đi tiếp theo.

        DỮ LIỆU ĐẦU VÀO (Kết quả phân tích từng phần):
        {all_insights_text}
        """
        
    final_report = engine.chat_sync([
        {"role": "system", "content": reduce_system_msg},
        {"role": "user", "content": reduce_user_msg}
    ], max_tokens=4000, temperature=0.4)
    
    return {
        "report": final_report,
        "intermediate_insights": intermediate_insights,
        "message": f"📊 Phân tích đa tầng Đã hoàn thành ({len(chunks)} phần). {idx_msg}",
        "path": path,
        "page_count": len(chunks)
    }


def tool_write_file(args: Dict[str, Any]) -> Dict[str, Any]:
    path = args.get("path") or ""
    content = args.get("content") or ""
    if not _check_path(path):
        return {"error": f"Path not allowed: {path}"}
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"message": f"File written: {path}", "size": len(content)}
    except Exception as e:
        return {"error": str(e)}


def tool_list_dir(args: Dict[str, Any]) -> Dict[str, Any]:
    path = args.get("path") or "."
    
    # If path is "." or empty, resolve it to current directory
    if path == ".":
        path = os.getcwd()
        
    if not _check_path(path):
        return {"error": f"Path not allowed: {path}"}
    if not os.path.isdir(path):
        return {"error": f"Not a directory: {path}"}
    try:
        items = []
        for entry in sorted(os.scandir(path), key=lambda e: (not e.is_dir(), e.name)):
            if entry.name.startswith("."):
                continue
            stat = entry.stat()
            items.append({
                "name": entry.name,
                "is_dir": entry.is_dir(),
                "size": stat.st_size if entry.is_file() else None,
            })
        return {"path": path, "items": items[:50]}
    except Exception as e:
        return {"error": str(e)}


_cached_screen_size = ""
_has_quartz = None  # None = not checked yet

def _try_quartz_screenshot(filepath_jpg):
    """Quartz fast path — returns (base64, w, h) or None."""
    global _has_quartz, _cached_screen_size
    if _has_quartz is False:
        return None
    try:
        import Quartz.CoreGraphics as CG
        from AppKit import NSBitmapImageRep, NSJPEGFileType
        _has_quartz = True

        image = CG.CGWindowListCreateImage(
            CG.CGRectInfinite,
            CG.kCGWindowListOptionOnScreenOnly,
            CG.kCGNullWindowID,
            CG.kCGWindowImageDefault,
        )
        if not image:
            return None
        w = CG.CGImageGetWidth(image)
        h = CG.CGImageGetHeight(image)
        _cached_screen_size = f"0, 0, {w}, {h}"
        bitmap = NSBitmapImageRep.alloc().initWithCGImage_(image)
        jpg_data = bitmap.representationUsingType_properties_(
            NSJPEGFileType, {"NSImageCompressionFactor": 0.5}
        )
        jpg_data.writeToFile_atomically_(filepath_jpg, True)
        img_b64 = base64.b64encode(bytes(jpg_data)).decode()
        return (img_b64, w, h)
    except ImportError:
        _has_quartz = False
        return None
    except Exception:
        return None


def tool_screenshot(args: Dict[str, Any]) -> Dict[str, Any]:
    """Take a screenshot — tries Quartz (fast), falls back to screencapture."""
    global _cached_screen_size
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

    # ── Try Quartz (instant, no subprocess) ──────────────────────────────
    jpg_path = os.path.join(SCREENSHOT_DIR, f"screenshot_{timestamp}.jpg")
    qr = _try_quartz_screenshot(jpg_path)
    if qr:
        img_b64, w, h = qr
        return {
            "path": jpg_path,
            "filename": os.path.basename(jpg_path),
            "base64": img_b64,
            "screen_size": _cached_screen_size,
            "message": f"Screenshot {w}x{h}",
        }

    # ── Fallback: screencapture ──────────────────────────────────────────
    png_path = os.path.join(SCREENSHOT_DIR, f"screenshot_{timestamp}.png")
    try:
        result = subprocess.run(
            ["screencapture", "-x", "-C", png_path],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and os.path.isfile(png_path):
            with open(png_path, "rb") as f:
                img_data = base64.b64encode(f.read()).decode()
            # Get screen size once
            if not _cached_screen_size:
                try:
                    sr = subprocess.run(
                        ["osascript", "-e", 'tell application "Finder" to get bounds of window of desktop'],
                        capture_output=True, text=True, timeout=3,
                    )
                    _cached_screen_size = sr.stdout.strip()
                except Exception:
                    pass
            return {
                "path": png_path,
                "filename": os.path.basename(png_path),
                "base64": img_data,
                "screen_size": _cached_screen_size,
                "message": f"Screenshot saved",
            }
    except Exception as e:
        logger.warning(f"screencapture error: {e}")

    return {
        "error": "Screenshot failed. Grant Screen Recording permission.",
        "screen_size": _cached_screen_size,
    }


def tool_update_docs(args: Dict[str, Any]) -> Dict[str, Any]:
    """Append a changelog entry to DOCS.md."""
    entry = args.get("entry") or ""
    # Get root dir from core.config (which is one level up from core)
    from core.config import BACKEND_DIR
    project_root = BACKEND_DIR.parent
    docs_path = project_root / "CLAUDE.md"
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    try:
        with open(docs_path, "r", encoding="utf-8") as f:
            content = f.read()

        changelog_header = "\n---\n\n## 📝 Changelog\n\n"
        if "## 📝 Changelog" not in content:
            content += changelog_header

        # Insert new entry after the changelog header
        new_entry = f"- **[{timestamp}]** {entry}\n"
        content = content.replace(
            "## 📝 Changelog\n\n",
            f"## 📝 Changelog\n\n{new_entry}",
        )

        with open(docs_path, "w", encoding="utf-8") as f:
            f.write(content)

        return {"message": f"Docs updated: {entry}"}
    except Exception as e:
        return {"error": str(e)}


def tool_create_background_task(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Spawn a background agent task when user asks to run something 'in the background' or 'tạo task'.
    IMPORTANT: You must parse the user's objective, CREATE a detailed step-by-step plan, 
    and pass BOTH the goal and the detailed plan into the 'prompt' argument so the background agent knows exactly what to do.
    """
    prompt = args.get("prompt") or ""
    if not prompt:
        return {"error": "prompt is required"}
    try:
        from core.task_runner import TaskRunner
        from db.psql.session import SessionLocal
        from db.psql.models.user import User
        from db.psql.models.task import AITask
        
        db = SessionLocal()
        try:
            from core.llm_engine import LLMEngine
            from core.agent_executor import current_session_id
            
            session_id = current_session_id.get(None)
            
            engine = LLMEngine.get()
            provider = engine.provider if engine else "agent"

            user = db.query(User).first()
            user_id = user.id if user else 1
            
            task = AITask(user_id=user_id, prompt=prompt, status="pending", model_name=provider)
            db.add(task)
            db.commit()
            db.refresh(task)
            
            TaskRunner.get().start_task(task.id, user_id, prompt, session_id=session_id)
            
            return {
                "message": f"Successfully created background task ID {task.id}. It is now running independently and the final result will be forwarded to the chat history.",
                "task_id": task.id
            }
        finally:
            db.close()
    except Exception as e:
        return {"error": f"Failed to create background task: {str(e)}"}


def tool_web_search(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search the web using duckduckgo_search library."""
    query = args.get("query") or ""
    max_results = min(args.get("max_results") or 5, 10)  # Capped at 10

    if not query:
        return {"error": "Query is required"}

    logger.info(f"🔍 Web search via DDGS: {query}")
    try:
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS

        with DDGS() as ddgs:
            raw_results = list(ddgs.text(query, max_results=max_results))
        
        results = []
        for r in raw_results:
            results.append({
                "title": r.get("title", ""),
                "snippet": r.get("body", ""),
                "url": r.get("href", ""),
            })

        if not results:
            return {"query": query, "results": [], "message": "No results found"}

        return {
            "query": query,
            "count": len(results),
            "results": results
        }
    except Exception as e:
        logger.error(f"❌ Web search error: {e}")
        return {"error": f"Search failed: {str(e)}"}


def tool_read_web(args: Dict[str, Any]) -> Dict[str, Any]:
    """Read/scrape content from a web page URL using trafilatura for smart extraction."""
    import re as _re

    url = args.get("url") or ""
    if not url:
        return {"error": "URL is required"}

    logger.info(f"🌐 Read web: {url}")
    try:
        # Primary: trafilatura (handles JS-rendered sites, extracts article content)
        try:
            import trafilatura
            downloaded = trafilatura.fetch_url(url)
            if downloaded:
                title_match = _re.search(r'<title[^>]*>(.*?)</title>', downloaded, _re.DOTALL | _re.IGNORECASE)
                title = _re.sub(r'<[^>]+>', '', title_match.group(1)).strip() if title_match else ""

                text = trafilatura.extract(
                    downloaded,
                    include_links=False,
                    include_comments=False,
                    include_tables=True,
                )
                if text and len(text.strip()) > 50:
                    if len(text) > 5000:
                        text = text[:5000] + f"\n\n... [truncated, total {len(text)} chars]"
                    return {"url": url, "title": title, "content": text, "length": len(text)}
        except Exception as e:
            logger.debug(f"trafilatura failed for {url}: {e}")

        # Fallback: curl + regex
        result = subprocess.run(
            [
                "curl", "-sL", "--compressed",
                "-A", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "-H", "Accept-Language: vi-VN,vi;q=0.9,en;q=0.8",
                "--max-time", "15",
                url,
            ],
            capture_output=True, timeout=20,
        )

        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", "replace")
            return {"error": f"Failed to fetch URL: {stderr[:500]}"}

        if not result.stdout:
             return {"error": "Empty response from URL"}

        html = result.stdout.decode("utf-8", "replace")

        title_match = _re.search(r'<title[^>]*>(.*?)</title>', html, _re.DOTALL | _re.IGNORECASE)
        title = _re.sub(r'<[^>]+>', '', title_match.group(1)).strip() if title_match else ""

        # Try trafilatura on raw HTML
        try:
            import trafilatura
            text = trafilatura.extract(html, include_links=False, include_comments=False)
            if text and len(text.strip()) > 50:
                if len(text) > 5000:
                    text = text[:5000] + f"\n\n... [truncated, total {len(text)} chars]"
                return {"url": url, "title": title, "content": text, "length": len(text)}
        except Exception:
            pass

        # Last resort: basic strip
        text = _re.sub(r'<script[^>]*>.*?</script>', '', html, flags=_re.DOTALL | _re.IGNORECASE)
        text = _re.sub(r'<style[^>]*>.*?</style>', '', text, flags=_re.DOTALL | _re.IGNORECASE)
        text = _re.sub(r'<[^>]+>', ' ', text)
        text = _re.sub(r'\s+', ' ', text).strip()
        
        # Auto-index for session
        idx_msg = _auto_index_content(text, source=f"web:{url}")

        if len(text) > 5000:
            text = text[:5000] + f"\n\n... [truncated, total {len(text)} chars]"

        return {
            "url": url, 
            "title": title, 
            "content": text, 
            "length": len(text),
            "rag_status": idx_msg
        }
    except subprocess.TimeoutExpired:
        return {"error": "Read web timed out (20s)"}
    except Exception as e:
        return {"error": f"Read web failed: {str(e)}"}


def tool_deep_search(args: Dict[str, Any]) -> Dict[str, Any]:
    """Deep search: search web → crawl each result → extract content → return all."""
    import re as _re
    import concurrent.futures

    query = args.get("query") or ""
    max_results = min(args.get("max_results") or 5, 8)

    if not query:
        return {"error": "Query is required"}

    logger.info(f"🔎 Deep search: '{query}' (max {max_results} results)")

    # Step 1: Search via ddgs (new package) with fallback to old duckduckgo_search
    raw_results = []
    try:
        from ddgs import DDGS
        with DDGS() as ddgs:
            raw_results = list(ddgs.text(query, max_results=max_results))
    except ImportError:
        try:
            from duckduckgo_search import DDGS as DDGS_OLD
            with DDGS_OLD() as ddgs:
                raw_results = list(ddgs.text(query, max_results=max_results))
        except Exception as e:
            logger.error(f"❌ Deep search - search failed: {e}")
            return {"error": f"Search failed: {str(e)}"}
    except Exception as e:
        logger.error(f"❌ Deep search - search failed: {e}")
        return {"error": f"Search failed: {str(e)}"}

    if not raw_results:
        return {"query": query, "results": [], "message": "No results found"}

    # Filter out video sites (YouTube, TikTok) — they're JS-rendered, return no useful text
    _skip_domains = {"youtube.com", "youtu.be", "tiktok.com", "instagram.com", "twitter.com", "x.com"}
    filtered = []
    for r in raw_results:
        url = r.get("href", "")
        if any(d in url for d in _skip_domains):
            continue
        filtered.append(r)
    # If too many filtered out, search more
    if len(filtered) < 2 and len(raw_results) > len(filtered):
        try:
            from ddgs import DDGS
            with DDGS() as ddgs:
                extra = list(ddgs.text(query + " -site:youtube.com", max_results=max_results))
            for r in extra:
                url = r.get("href", "")
                if not any(d in url for d in _skip_domains):
                    if url not in [x.get("href", "") for x in filtered]:
                        filtered.append(r)
        except Exception:
            pass
    raw_results = filtered[:max_results] if filtered else raw_results[:max_results]

    # Step 2: Crawl each URL in parallel using trafilatura for smart extraction
    def _fetch_url(item):
        url = item.get("href", "")
        title = item.get("title", "")
        snippet = item.get("body", "")
        if not url:
            return {"title": title, "url": "", "snippet": snippet, "content": "", "error": "No URL"}

        try:
            # Use trafilatura for intelligent article extraction (handles JS-rendered sites)
            try:
                import trafilatura
                downloaded = trafilatura.fetch_url(url)
                if downloaded:
                    text = trafilatura.extract(
                        downloaded,
                        include_links=False,
                        include_comments=False,
                        include_tables=True,
                    )
                    if text and len(text.strip()) > 50:
                        if len(text) > 3000:
                            text = text[:3000] + "..."
                        return {"title": title, "url": url, "snippet": snippet, "content": text}
            except Exception as e:
                logger.debug(f"trafilatura failed for {url}: {e}")

            # Fallback: curl + regex strip
            result = subprocess.run(
                [
                    "curl", "-sL", "--compressed",
                    "-A", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "-H", "Accept-Language: vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
                    "--max-time", "10",
                    url,
                ],
                capture_output=True, timeout=15,
            )

            if result.returncode != 0 or not result.stdout:
                return {"title": title, "url": url, "snippet": snippet, "content": "", "error": "Fetch failed"}

            html = result.stdout.decode("utf-8", "replace")

            # Try trafilatura on raw HTML as second chance
            try:
                import trafilatura
                text = trafilatura.extract(html, include_links=False, include_comments=False)
                if text and len(text.strip()) > 50:
                    if len(text) > 3000:
                        text = text[:3000] + "..."
                    return {"title": title, "url": url, "snippet": snippet, "content": text}
            except Exception:
                pass

            # Last resort: basic regex strip
            text = _re.sub(r'<script[^>]*>.*?</script>', '', html, flags=_re.DOTALL | _re.IGNORECASE)
            text = _re.sub(r'<style[^>]*>.*?</style>', '', text, flags=_re.DOTALL | _re.IGNORECASE)
            text = _re.sub(r'<nav[^>]*>.*?</nav>', '', text, flags=_re.DOTALL | _re.IGNORECASE)
            text = _re.sub(r'<footer[^>]*>.*?</footer>', '', text, flags=_re.DOTALL | _re.IGNORECASE)
            text = _re.sub(r'<[^>]+>', ' ', text)
            text = _re.sub(r'\s+', ' ', text).strip()

            if len(text) < 50:
                return {"title": title, "url": url, "snippet": snippet, "content": "", "error": "Page content too short (JS-rendered?)"}

            if len(text) > 3000:
                text = text[:3000] + "..."

            return {"title": title, "url": url, "snippet": snippet, "content": text}

        except Exception as e:
            return {"title": title, "url": url, "snippet": snippet, "content": "", "error": str(e)}

    # Parallel crawl (max 5 workers)
    crawled = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_fetch_url, item): item for item in raw_results}
        for future in concurrent.futures.as_completed(futures):
            try:
                crawled.append(future.result())
            except Exception as e:
                crawled.append({"error": str(e)})

    # Step 3: Build comprehensive result with clear structure
    successful = [r for r in crawled if r.get("content")]

    combined_text = f"=== SEARCH RESULTS FOR: \"{query}\" ===\n"
    combined_text += f"Sources crawled: {len(successful)}/{len(crawled)}\n\n"

    for i, r in enumerate(crawled, 1):
        combined_text += f"━━━ SOURCE [{i}] ━━━\n"
        combined_text += f"Title: {r.get('title', 'No title')}\n"
        combined_text += f"URL: {r.get('url', '')}\n"
        if r.get("content"):
            combined_text += f"Content:\n{r['content']}\n\n"
        elif r.get("snippet"):
            combined_text += f"Snippet: {r['snippet']}\n\n"
        else:
            combined_text += f"Error: {r.get('error', 'unknown')}\n\n"

    if len(combined_text) > 15000:
        combined_text = combined_text[:15000] + "\n\n... [truncated]"

    # Auto-index combined results for session memory
    idx_msg = _auto_index_content(combined_text, source=f"deep_search:{query}")

    return {
        "query": query,
        "total_results": len(crawled),
        "successful_crawls": len(successful),
        "combined_content": combined_text,
        "message": (
            f"Searched and crawled {len(successful)} pages. "
            f"RAG: {idx_msg}. "
            "IMPORTANT: Read the combined_content carefully. "
            "Extract EXACT numbers, prices, and data — do NOT guess or fabricate. "
            "Cite which source URL each fact came from."
        ),
    }


def tool_edit_file(args: Dict[str, Any]) -> Dict[str, Any]:
    """Edit a file by replacing a unique snippet of text."""
    path = args.get("path") or ""
    old_text = args.get("old_text") or ""
    new_text = args.get("new_text") or ""

    if not path or old_text is None:
        return {"error": "path and old_text are required"}
        
    path = _resolve_relative_path(path)
    
    if not _check_path(path):
        return {"error": f"Path not allowed: {path}"}
    if not os.path.isfile(path):
        return {"error": f"File not found: {path} (Current Working Directory: {os.getcwd()})"}

    logger.info(f"✏️ Edit file: {path}")
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        if old_text not in content:
            # Try to find a partial match or provide context
            lines = content.splitlines()
            # If AI provided multiple lines, maybe some have wrong indentation?
            # For now, just show first 30 lines as context.
            preview = "\n".join(lines[:30])
            return {
                "error": "The exact string 'old_text' was not found in the file.",
                "hint": "Ensure 'old_text' matches exactly, including all whitespace and indentation. Use a UNIQUE snippet.",
                "file_context_top_30": preview
            }

        count = content.count(old_text)
        if count > 1:
            return {
                "error": f"The 'old_text' snippet was found {count} times. It must be UNIQUE so I know which one to replace.",
                "hint": "Include more surrounding lines in 'old_text' to make it unique."
            }

        new_content = content.replace(old_text, new_text, 1) # Only replace the 1st (unique) occurrence
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)

        return {
            "replacements": count,
            "path": path,
        }
    except Exception as e:
        return {"error": str(e)}


def tool_replace_lines(args: Dict[str, Any]) -> Dict[str, Any]:
    """Replace lines between start_line and end_line (1-indexed) with new_text."""
    path = args.get("path") or ""
    start_line = args.get("start_line") or 0
    end_line = args.get("end_line") or 0
    new_text = args.get("new_text") or ""

    if not path or not start_line or not end_line:
        return {"error": "path, start_line, and end_line are required"}
    try:
        start_line = int(start_line)
        end_line = int(end_line)
    except ValueError:
        return {"error": "start_line and end_line must be integers"}

    path = _resolve_relative_path(path)
    
    if not _check_path(path):
        return {"error": f"Path not allowed: {path}"}
    if not os.path.isfile(path):
        return {"error": f"File not found: {path} (Current Working Directory: {os.getcwd()})"}

    logger.info(f"✏️ Replace lines {start_line}-{end_line} in: {path}")
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        start_idx = start_line - 1
        end_idx = end_line

        if start_idx < 0:
            return {"error": f"Invalid start_line {start_line}. Must be >= 1."}
            
        if end_idx < start_idx:
            return {"error": f"Invalid end_line {end_line}. Must be >= start_line."}
            
        if start_idx > len(lines):
            return {"error": f"Invalid start_line {start_line}. File only has {len(lines)} lines."}

        end_idx = min(end_idx, len(lines))

        new_lines = []
        if new_text:
            new_lines = [new_text]
            if not new_text.endswith("\n") and end_idx < len(lines):
                new_lines = [new_text + "\n"]

        final_lines = lines[:start_idx] + new_lines + lines[end_idx:]

        with open(path, "w", encoding="utf-8") as f:
            f.writelines(final_lines)

        return {
            "replaced_lines_count": end_idx - start_idx,
            "path": path,
            "message": f"Successfully replaced lines {start_line} to {end_line}.",
        }
    except Exception as e:
        return {"error": str(e)}


def tool_search_code(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search for text/pattern in files using grep."""
    query = args.get("query") or ""
    path = args.get("path") or "."
    path = _resolve_relative_path(path)
    include = args.get("include") or ""

    if not query:
        return {"error": "query is required"}
    if not _check_path(path):
        return {"error": f"Path not allowed: {path} (Current Working Directory: {os.getcwd()})"}

    logger.info(f"🔎 Search code: '{query}' in {path}")
    try:
        cmd = ["grep", "-rnI", "--color=never", "-m", "50"]
        if include:
            cmd.extend(["--include", include])
        cmd.extend([query, path])

        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=15,
            env=os.environ.copy(),
        )

        matches = []
        for line in result.stdout.strip().split('\n'):
            if not line:
                continue
            # Format: file:line_num:content
            parts = line.split(':', 2)
            if len(parts) >= 3:
                matches.append({
                    "file": parts[0],
                    "line": int(parts[1]) if parts[1].isdigit() else 0,
                    "content": parts[2].strip()[:200],
                })

        if not matches:
            return {"query": query, "matches": [], "message": "No matches found"}

        return {
            "query": query,
            "count": len(matches),
            "matches": matches[:30],  # Limit results
        }
    except subprocess.TimeoutExpired:
        return {"error": "Search timed out (15s)"}
    except Exception as e:
        return {"error": f"Search failed: {str(e)}"}


def tool_find_files(args: Dict[str, Any]) -> Dict[str, Any]:
    """Find files by name pattern in a directory."""
    pattern = args.get("pattern") or ""
    path = args.get("path") or "."
    path = _resolve_relative_path(path)
    file_type = args.get("type") or ""  # 'file' or 'dir'

    if not pattern:
        return {"error": "pattern is required"}
    if not _check_path(path):
        return {"error": f"Path not allowed: {path} (Current Working Directory: {os.getcwd()})"}

    logger.info(f"📂 Find files: '{pattern}' in {path}")
    try:
        # Depth 15 is enough for most professional hierarchies
        cmd = ["find", path, "-maxdepth", "15", "-name", pattern]
        if file_type == "file":
            cmd.extend(["-type", "f"])
        elif file_type == "dir":
            cmd.extend(["-type", "d"])
        # Exclude common noise
        cmd.extend([
            "-not", "-path", "*/node_modules/*",
            "-not", "-path", "*/.git/*",
            "-not", "-path", "*/__pycache__/*",
            "-not", "-path", "*/.venv/*",
        ])

        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=15,
            env=os.environ.copy(),
        )

        files = [f for f in result.stdout.strip().split('\n') if f]

        if not files:
            return {"pattern": pattern, "files": [], "message": "No files found"}

        return {
            "pattern": pattern,
            "count": len(files),
            "files": files[:50],  # Limit
        }
    except subprocess.TimeoutExpired:
        return {"error": "Find timed out (15s)"}
    except Exception as e:
        return {"error": f"Find failed: {str(e)}"}



def tool_browser_go(args: Dict[str, Any]) -> Dict[str, Any]:
    """Navigate the CURRENT active tab to a new URL (no new tab)."""
    url = args.get("url") or ""
    browser = _resolve_browser(url, args.get("browser", ""))
    wait = float(args.get("wait") or 3)
    if not url:
        return {"error": "url is required"}
    logger.info(f"🌐 Navigating current tab to: {url}")
    script = f'''
    tell application "{browser}"
        activate
        if (count of windows) > 0 then
            set URL of active tab of front window to "{url}"
        else
            make new window
            set URL of active tab of front window to "{url}"
        end if
    end tell
    '''
    try:
        res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=10)
        if res.returncode != 0:
            return {"error": f"AppleScript error: {res.stderr.strip()}"}
        _agent_opened_urls.append(url)
        import time
        time.sleep(wait)
        return {"message": f"Navigated to {url}, waited {wait}s."}
    except Exception as e:
        return {"error": str(e)}


def tool_site_search(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search directly on popular sites via URL — no need to find search box.

    Supported sites: youtube, google, shopee, tiktok, github, stackoverflow, wikipedia.
    Opens results page directly.
    """
    import urllib.parse

    site = args.get("site", "google").lower().strip()
    query = args.get("query", "").strip()
    # Browser will be resolved by tool_open_browser via _resolve_browser
    browser = args.get("browser", "")

    if not query:
        return {"error": "query is required"}

    q = urllib.parse.quote_plus(query)

    SEARCH_URLS = {
        "youtube":       f"https://www.youtube.com/results?search_query={q}",
        "yt":            f"https://www.youtube.com/results?search_query={q}",
        "google":        f"https://www.google.com/search?q={q}",
        "shopee":        f"https://shopee.vn/search?keyword={q}",
        "tiktok":        f"https://www.tiktok.com/search?q={q}",
        "github":        f"https://github.com/search?q={q}",
        "stackoverflow": f"https://stackoverflow.com/search?q={q}",
        "wikipedia":     f"https://vi.wikipedia.org/w/index.php?search={q}",
        "wiki":          f"https://vi.wikipedia.org/w/index.php?search={q}",
        "facebook":      f"https://www.facebook.com/search/top/?q={q}",
        "fb":            f"https://www.facebook.com/search/top/?q={q}",
    }

    url = SEARCH_URLS.get(site)
    if not url:
        # Unknown site — try google with site: prefix
        url = "https://www.google.com/search?q=" + q + "+site:" + site

    logger.info(f"🔍 Site search: {site} → {query}")
    result = tool_open_browser({"url": url, "browser": browser})
    return {
        "message": f"Opened {site} search for '{query}'. Use browser_read to see results.",
        "url": url,
        **result,
    }


def tool_open_browser(args: Dict[str, Any]) -> Dict[str, Any]:
    """Open a URL in a background browser tab (no focus steal)."""
    url = args.get("url") or ""
    browser = _resolve_browser(url, args.get("browser", ""))
    if not url:
        return {"error": "url is required"}
    logger.info(f"🌐 Opening browser (background): {url} in {browser}")
    # No 'activate' — opens tab without bringing Chrome to foreground
    script = f'''
    tell application "{browser}"
        if (count of windows) = 0 then
            make new window
        end if
        tell front window
            set newTab to make new tab with properties {{URL:"{url}"}}
            return id of newTab
        end tell
    end tell
    '''
    try:
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=15)
        if result.returncode != 0:
            return {"error": f"AppleScript error: {result.stderr.strip()}"}

        tab_id = result.stdout.strip()
        if tab_id.isdigit():
            _agent_opened_tabs.append((browser, tab_id))
            logger.info(f"📍 Tracked new tab ID: {tab_id}")
        _agent_opened_urls.append(url)
        logger.info(f"📍 Tracked URL: {url[:80]}")

        import time
        time.sleep(5)

        return {"message": f"Opened {url} in background tab ({browser}), waited 5s for load."}
    except Exception as e:
        return {"error": str(e)}


def tool_browser_js(args: Dict[str, Any]) -> Dict[str, Any]:
    """Execute JavaScript in the current browser tab via AppleScript."""
    script_js = args.get("script") or ""
    browser = args.get("browser") or _active_browser
    if not script_js:
        return {"error": "script is required"}
    # Escape for AppleScript double-quoted string
    escaped = script_js.replace('\\', '\\\\').replace('"', '\\"')
    apple_script = f'''
    tell application "{browser}"
        set r to execute active tab of front window javascript "{escaped}"
        return r
    end tell
    '''
    logger.info(f"🧪 Browser JS: {script_js[:80]}")
    try:
        result = subprocess.run(["osascript", "-e", apple_script], capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            return {"error": f"JS error: {result.stderr.strip()}"}
        return {"result": result.stdout.strip()}
    except Exception as e:
        return {"error": str(e)}


def cleanup_agent_browser_tabs():
    """Close all tabs that were opened by the agent in this session.

    Two-pass approach:
    1. Close by tracked tab IDs (fast, may miss some)
    2. Close by tracked URLs (catches redirected/renamed tabs)
    """
    global _agent_opened_tabs, _agent_opened_urls

    closed_count = 0
    browser = "Google Chrome"

    # Pass 1: Close by tab ID
    if _agent_opened_tabs:
        logger.info(f"🧹 Cleanup Pass 1: {len(_agent_opened_tabs)} tracked tab IDs")
        items = list(_agent_opened_tabs)
        _agent_opened_tabs = []
        for b, tid in items:
            script = f'''
            tell application "{b}"
                repeat with w in windows
                    try
                        close (every tab of w whose id is {tid})
                    end try
                end repeat
            end tell
            '''
            try:
                subprocess.run(["osascript", "-e", script], capture_output=True, timeout=5)
                closed_count += 1
            except Exception:
                pass

    # Pass 2: Close by URL patterns (catches tabs that changed ID after redirect)
    if _agent_opened_urls:
        logger.info(f"🧹 Cleanup Pass 2: {len(_agent_opened_urls)} tracked URLs")
        urls = list(_agent_opened_urls)
        _agent_opened_urls = []
        for url_pattern in urls:
            # Extract domain for matching (e.g. "youtube.com" from full URL)
            try:
                from urllib.parse import urlparse
                domain = urlparse(url_pattern).netloc
                if not domain:
                    continue
                script = f'''
                tell application "{browser}"
                    set closedCount to 0
                    repeat with w in windows
                        set tabList to every tab of w
                        repeat with t in tabList
                            try
                                if URL of t contains "{domain}" then
                                    close t
                                    set closedCount to closedCount + 1
                                end if
                            end try
                        end repeat
                    end repeat
                    return closedCount
                end tell
                '''
                res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=10)
                count = res.stdout.strip()
                if count and count != "0":
                    closed_count += int(count)
                    logger.info(f"✅ Closed {count} tab(s) matching {domain}")
            except Exception as e:
                logger.error(f"❌ URL cleanup error: {e}")

    if closed_count == 0:
        logger.info("ℹ️ Cleanup: No tabs to close.")
    else:
        logger.info(f"🧹 Total closed: {closed_count} tabs")

    return {"message": f"Closed {closed_count} agent tabs.", "total": closed_count}


def tool_browser_close_tab(args: Dict[str, Any]) -> Dict[str, Any]:
    """Close browser tab(s). Modes:
    - No args / which='current': close the active (front) tab
    - which='all_agent': close all tabs opened by the agent this session
    - which='url' + url='...': close tabs matching a URL substring
    """
    global _agent_opened_tabs
    browser = args.get("browser", _active_browser)
    which = args.get("which", "current")

    if which == "all_agent":
        result = cleanup_agent_browser_tabs()
        return result

    if which == "url":
        url_match = args.get("url", "")
        if not url_match:
            return {"error": "url is required when which='url'"}
        # Close all tabs whose URL contains the substring
        script = f'''
        tell application "{browser}"
            set closedCount to 0
            repeat with w in windows
                set tabList to every tab of w
                repeat with t in tabList
                    try
                        if URL of t contains "{url_match}" then
                            close t
                            set closedCount to closedCount + 1
                        end if
                    end try
                end repeat
            end repeat
            return closedCount
        end tell
        '''
        try:
            res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=10)
            if res.returncode != 0:
                return {"error": f"AppleScript error: {res.stderr.strip()}"}
            count = res.stdout.strip()
            # Also remove from tracked list
            _agent_opened_tabs = [(b, tid) for b, tid in _agent_opened_tabs if b != browser]
            return {"message": f"Closed {count} tab(s) matching '{url_match}'"}
        except Exception as e:
            return {"error": str(e)}

    # Default: close current (active) tab
    script = f'''
    tell application "{browser}"
        if (count of windows) > 0 then
            set t to active tab of front window
            set tid to id of t
            close t
            return tid
        else
            return "no_window"
        end if
    end tell
    '''
    try:
        res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=10)
        if res.returncode != 0:
            return {"error": f"AppleScript error: {res.stderr.strip()}"}
        tid = res.stdout.strip()
        if tid == "no_window":
            return {"message": "No browser window open"}
        # Remove from tracked list if it was tracked
        _agent_opened_tabs = [(b, t) for b, t in _agent_opened_tabs if t != tid]
        logger.info(f"🗑️ Closed active tab (id={tid}) in {browser}")
        return {"message": f"Closed active tab (id={tid})"}
    except Exception as e:
        return {"error": str(e)}


def tool_browser_read(args: Dict[str, Any]) -> Dict[str, Any]:
    """Read text + interactive elements from browser tab, then auto-screenshot with badges visible."""
    import time as _time
    browser = args.get("browser") or _active_browser

    # JS: tag elements with visual badges + return text + element list
    js_extractor = r'''
        (function() {
            var previous = document.querySelectorAll('.hatai-v-badge, .hatai-bbox');
            for(var j=0; j<previous.length; j++) previous[j].remove();

            var els = document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="textbox"], [contenteditable="true"], [contenteditable=""], [tabindex], [data-placeholder], .ProseMirror, [class*="prompt"], [class*="chat-input"], [class*="composer"], #prompt-textarea');
            var result = "Interactive Elements:\n";
            var idCount = 1;

            for(var i=0; i<els.length; i++) {
                if(idCount >= 80) break;
                var el = els[i];
                var rect = el.getBoundingClientRect();
                var style = window.getComputedStyle(el);

                if(
                    rect.width === 0 || rect.height === 0 ||
                    style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' ||
                    rect.bottom < 0 || rect.top > (window.innerHeight || document.documentElement.clientHeight) ||
                    rect.right < 0 || rect.left > (window.innerWidth || document.documentElement.clientWidth)
                ) continue;

                var tag = el.tagName.toLowerCase();
                var text = (el.innerText || el.value || el.placeholder || el.title || el.getAttribute('aria-label') || el.className || "").trim().substring(0, 40).replace(/\n/g, ' ');

                var isEditable = el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '' || el.getAttribute('role') === 'textbox';
                if(tag === 'input' || tag === 'textarea') {
                    text = "[" + (el.placeholder || el.getAttribute('aria-label') || el.name || "input") + "] " + (el.value || "");
                } else if(isEditable || el.classList.contains('ProseMirror')) {
                    var ph = el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || el.getAttribute('aria-label') || 'editable';
                    text = "[INPUT:" + ph + "] " + (el.innerText || "").substring(0, 30);
                }
                if(!text.trim()) text = tag;

                el.setAttribute('data-hatai-id', idCount);

                var screenX = rect.left + window.screenX;
                var screenY = rect.top + (window.outerHeight - window.innerHeight) + window.screenY;
                var centerX = screenX + rect.width / 2;
                var centerY = screenY + rect.height / 2;

                var badge = document.createElement('div');
                badge.className = 'hatai-v-badge';
                badge.innerText = '[' + idCount + ']';
                badge.style.cssText = 'position:absolute;top:' + (rect.top + window.scrollY - 10) + 'px;left:' + (rect.left + window.scrollX - 10) + 'px;background:#FFEB3B;color:#000;border:1px solid #000;font-size:12px;font-weight:bold;z-index:2147483647;pointer-events:none;padding:0 3px;';
                document.body.appendChild(badge);

                var box = document.createElement('div');
                box.className = 'hatai-bbox';
                box.style.cssText = 'position:absolute;top:' + (rect.top + window.scrollY) + 'px;left:' + (rect.left + window.scrollX) + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;border:2px dashed #00BCD4;z-index:2147483646;pointer-events:none;opacity:0.3;';
                document.body.appendChild(box);

                result += "- [" + idCount + "] " + text + " {x:" + Math.round(centerX) + ",y:" + Math.round(centerY) + "}\n";
                idCount++;
            }

            var pageText = document.body ? document.body.innerText.substring(0, 2500) : '';
            return pageText + "\n\n" + result;
        })()
    '''
    escaped_js = js_extractor.replace('\\', '\\\\').replace('"', '\\"')

    apple_script = f'''
    tell application "{browser}"
        set pageTitle to title of active tab of front window
        set pageText to execute active tab of front window javascript "{escaped_js}"
        return pageTitle & "\\n---\\n" & pageText
    end tell
    '''
    logger.info(f"📖 Browser read page (advanced)")
    try:
        res = subprocess.run(["osascript", "-e", apple_script], capture_output=True, text=True, timeout=30)
        if res.returncode != 0:
            return {"error": f"Read error: {res.stderr.strip()}"}

        content = res.stdout.strip()
        parts = content.split("\n---\n", 1)
        title = parts[0] if parts else ""
        page_content = parts[1][:2500] if len(parts) > 1 else content[:2500]

        # Auto-screenshot with badges visible (optional — don't fail if screenshot broken)
        screenshot_b64 = ""
        screen_size = _cached_screen_size
        try:
            screenshot_result = tool_screenshot({})
            screenshot_b64 = screenshot_result.get("base64", "")
            screen_size = screenshot_result.get("screen_size", "") or screen_size
        except Exception as e:
            logger.warning(f"⚠️ browser_read screenshot failed (non-fatal): {e}")

        result = {
            "title": title,
            "content": page_content,
            "screen_size": screen_size,
            "message": f"Page scanned. Use ONLY numeric IDs like browser_click selector=5, NOT text. Screen: {screen_size}",
        }

        # Store screenshot separately — frontend-only, NOT for LLM context
        if screenshot_b64:
            result["_frontend_screenshot"] = screenshot_b64
            result["_frontend_screenshot_path"] = screenshot_result.get("path", "")

        return result
    except Exception as e:
        return {"error": str(e)}


def tool_browser_click(args: Dict[str, Any]) -> Dict[str, Any]:
    """Click a DOM element by CSS selector or numeric ID in the current browser tab."""
    import re
    import json as _json
    selector = str(args.get("selector") or "").strip()
    browser = args.get("browser") or _active_browser
    if not selector:
        return {"error": "selector is required"}

    # 1. Identify Target (Numeric ID or CSS)
    match = re.search(r'(\d+)', selector)
    if match:
        node_id = match.group(1)
        js_find = f'document.querySelector(\'[data-hatai-id="{node_id}"]\')'
    else:
        escaped_selector = selector.replace('"', '\\"')
        js_find = f'document.querySelector("{escaped_selector}") || document.getElementById("{escaped_selector}")'

    # Check if complex site (Facebook etc.) — prefer physical click
    js_site_check = f'''(function(){{
        var el = {js_find};
        if(!el) return "not_found";
        var url = window.location.hostname;
        var isComplex = url.includes('facebook.com') || url.includes('messenger.com') || url.includes('instagram.com');
        return isComplex ? "complex" : "standard";
    }})()'''
    site_res = tool_browser_js({"script": js_site_check, "browser": browser})
    site_val = site_res.get("result", "")

    if site_val == "not_found":
        return {"error": f"Element {selector} not found on page."}

    # For complex sites: skip JS click, go straight to physical click
    use_physical_first = (site_val == "complex")

    if not use_physical_first:
        # 2. Try JS click FIRST (silent, no focus steal)
        js_click = (
            f'(function(){{'
            f'  var el = {js_find};'
            f'  if(!el) return "not_found";'
            f'  el.scrollIntoView({{block: "center", behavior: "instant"}});'
            f'  ["mousedown", "mouseup", "click"].forEach(function(t) {{'
            f'    el.dispatchEvent(new MouseEvent(t, {{bubbles: true, cancelable: true, view: window}}));'
            f'  }});'
            f'  el.click();'
            f'  if(el.tagName === "A" && el.href) return "clicked_link";'
            f'  return "clicked";'
            f'}})()'
        )
        click_res = tool_browser_js({"script": js_click, "browser": browser})
        click_val = click_res.get("result", "")
        if click_val in ("clicked", "clicked_link"):
            return {"message": f"Clicked element {selector} (JS, background)."}

    # 3. Physical mouse click (works on all sites including Facebook)
    # Must activate Chrome first for physical clicks to work
    logger.info(f"🖱️ Physical click for {'complex site' if use_physical_first else 'JS fallback'}: {selector}")
    subprocess.run(["osascript", "-e", f'tell application "{browser}" to activate'],
                   capture_output=True, timeout=3)
    import time; time.sleep(0.2)
    js_coords = (
        f'(function(){{'
        f'  var el = {js_find};'
        f'  if(!el) return "null";'
        f'  el.scrollIntoView({{block: "center", behavior: "instant"}});'
        f'  var r = el.getBoundingClientRect();'
        f'  var toolbarH = window.outerHeight - window.innerHeight;'
        f'  var cx = Math.round(r.left + window.screenX + r.width / 2);'
        f'  var cy = Math.round(r.top + toolbarH + window.screenY + r.height / 2);'
        f'  return JSON.stringify({{x: cx, y: cy}});'
        f'}})()'
    )
    coords_res = tool_browser_js({"script": js_coords, "browser": browser})
    coords_str = coords_res.get("result", "").strip()
    if coords_str and coords_str not in ("null", "ms-null", ""):
        try:
            c = _json.loads(coords_str)
            if isinstance(c, dict) and "x" in c and "y" in c:
                logger.info(f"🖱️ Browser click physical at ({c['x']}, {c['y']})")
                return tool_sys_mouse({"x": c["x"], "y": c["y"], "action": "click"})
        except Exception as e:
            logger.error(f"Physical click failed: {e}")

    return {"error": f"Element {selector} could not be clicked."}


def tool_browser_type(args: Dict[str, Any]) -> Dict[str, Any]:
    """Type text into a browser element. Tries JS injection first (background), falls back to physical keyboard."""
    import re
    selector = str(args.get("selector") or "").strip()
    text = args.get("text") or ""
    browser = args.get("browser") or _active_browser

    if not selector:
        return {"error": "selector is required"}
    if not text:
        return {"error": "text is required"}

    # 1. Identify Target
    match = re.search(r'(\d+)', selector)
    if match:
        node_id = match.group(1)
        js_find = f'document.querySelector(\'[data-hatai-id="{node_id}"]\')'
    else:
        escaped_selector = selector.replace('"', '\\"')
        js_find = f'document.querySelector("{escaped_selector}") || document.getElementById("{escaped_selector}")'

    # Escape text for JS string
    js_text = text.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n')

    # Detect if site uses complex editors (Facebook, Messenger, etc.)
    # These MUST use physical keyboard — JS injection never works
    js_check_site = f'''(function(){{
        var el = {js_find};
        if(!el) return "not_found";
        var url = window.location.hostname;
        var isComplex = (
            url.includes('facebook.com') ||
            url.includes('messenger.com') ||
            url.includes('instagram.com') ||
            url.includes('twitter.com') ||
            url.includes('x.com') ||
            url.includes('linkedin.com') ||
            url.includes('slack.com') ||
            url.includes('discord.com') ||
            url.includes('notion.so') ||
            el.closest('[data-lexical-editor]') !== null ||
            el.closest('[class*="DraftEditor"]') !== null ||
            el.closest('[class*="ql-editor"]') !== null ||
            el.closest('.ProseMirror') !== null
        );
        return isComplex ? "complex_editor" : "standard";
    }})()'''

    site_check = tool_browser_js({"script": js_check_site, "browser": browser})
    site_type = site_check.get("result", "")

    if site_type == "not_found":
        return {"error": f"Element {selector} not found."}

    # For complex editors: go straight to physical keyboard (JS never works on these)
    if site_type == "complex_editor":
        logger.info(f"⌨️ Complex editor detected — using physical click + keyboard for {selector}")
        import time as _t
        import json as _json2

        # 1. Activate Chrome
        subprocess.run(["osascript", "-e", f'tell application "{browser}" to activate'],
                       capture_output=True, timeout=3)
        _t.sleep(0.2)

        # 2. Get physical coords and click the element (focus via mouse)
        js_coords = f'''(function(){{
            var el = {js_find};
            if(!el) return "null";
            el.scrollIntoView({{block: "center", inline: "center"}});
            var r = el.getBoundingClientRect();
            var toolbarH = window.outerHeight - window.innerHeight;
            var cx = Math.round(r.left + window.screenX + r.width / 2);
            var cy = Math.round(r.top + toolbarH + window.screenY + r.height / 2);
            return JSON.stringify({{x: cx, y: cy}});
        }})()'''
        coords_res = tool_browser_js({"script": js_coords, "browser": browser})
        coords_str = coords_res.get("result", "").strip()

        if coords_str and coords_str not in ("null", ""):
            try:
                c = _json2.loads(coords_str)
                if isinstance(c, dict) and "x" in c and "y" in c:
                    tool_sys_mouse({"x": c["x"], "y": c["y"], "action": "click"})
                    _t.sleep(0.3)
            except Exception:
                pass

        # 3. Clear any existing text with Cmd+A then Delete
        subprocess.run(["osascript", "-e",
            'tell application "System Events" to keystroke "a" using command down'],
            capture_output=True, timeout=5)
        _t.sleep(0.1)
        subprocess.run(["osascript", "-e",
            'tell application "System Events" to key code 51'],  # delete
            capture_output=True, timeout=5)
        _t.sleep(0.1)

        # 4. Type the text
        return tool_sys_type({"text": text, "app": browser})

    # 2. Standard sites: try pure JS typing (background, no focus steal)
    js_type = f'''(function(){{
        var el = {js_find};
        if(!el) return "not_found";
        el.scrollIntoView({{block: "center", inline: "center"}});
        var tag = el.tagName.toLowerCase();
        var isEditable = el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '' || el.getAttribute('role') === 'textbox' || el.classList.contains('ProseMirror');

        if(tag === 'input' || tag === 'textarea') {{
            el.focus();
            // Use native setter to bypass React controlled input
            var nativeSetter = Object.getOwnPropertyDescriptor(
                tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
            );
            if(nativeSetter && nativeSetter.set) {{
                nativeSetter.set.call(el, '{js_text}');
            }} else {{
                el.value = '{js_text}';
            }}
            el.dispatchEvent(new Event('input', {{bubbles: true}}));
            el.dispatchEvent(new Event('change', {{bubbles: true}}));
            return "typed_input";
        }}

        if(isEditable) {{
            el.focus();
            el.innerHTML = '';
            // Insert text node
            var textNode = document.createTextNode('{js_text}');
            el.appendChild(textNode);
            // Trigger input event for React/frameworks
            el.dispatchEvent(new Event('input', {{bubbles: true}}));
            el.dispatchEvent(new InputEvent('input', {{bubbles: true, inputType: 'insertText', data: '{js_text}'}}));
            // Place cursor at end
            var range = document.createRange();
            var sel = window.getSelection();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            return "typed_editable";
        }}

        el.focus();
        el.click();
        return "focused_only";
    }})()'''

    type_res = tool_browser_js({"script": js_type, "browser": browser})
    type_result = type_res.get("result", "")

    if type_result in ("typed_input", "typed_editable"):
        logger.info(f"⌨️ Browser type (JS background): {text[:40]!r}")
        return {"message": f"Typed '{text[:40]}' into element {selector} (JS, background)."}

    if type_result == "not_found":
        return {"error": f"Element {selector} not found."}

    # 3. Fallback: physical keyboard (needs Chrome foreground)
    logger.info(f"⌨️ Browser type fallback to physical keyboard for {selector}")
    # Focus element first
    js_focus = f'''(function(){{
        var el = {js_find};
        if(!el) return "not_found";
        el.scrollIntoView({{block: "center", inline: "center"}});
        el.focus();
        el.click();
        return "focused";
    }})()'''
    tool_browser_js({"script": js_focus, "browser": browser})

    import time
    time.sleep(0.2)
    return tool_sys_type({"text": text, "app": browser})

def tool_sys_key(args: Dict[str, Any]) -> Dict[str, Any]:
    """Press a key combination via macOS System Events."""
    key = args.get("key") or ""
    modifiers = args.get("modifiers") or []

    if not key:
        return {"error": "key is required"}

    mods = []
    if isinstance(modifiers, str):
        modifiers = [modifiers]

    for m in modifiers:
        m_lower = m.lower()
        if m_lower in ["command", "cmd"]: mods.append("command down")
        elif m_lower in ["shift"]: mods.append("shift down")
        elif m_lower in ["option", "alt"]: mods.append("option down")
        elif m_lower in ["control", "ctrl"]: mods.append("control down")

    using_clause = f" using {{{', '.join(mods)}}}" if mods else ""

    special = {
        "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51,
        "escape": 53, "esc": 53, "left": 123, "right": 124, "down": 125, "up": 126,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
        "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
        "forward_delete": 117,
    }

    app_focus = args.get("app", args.get("browser", ""))
    activate_cmd = f'tell application "{app_focus}" to activate' if app_focus else ""

    key_lower = key.lower()
    if key_lower in special:
        script = f'''
        {activate_cmd}
        tell application "System Events" to key code {special[key_lower]}{using_clause}
        '''
    else:
        # Escape special characters for AppleScript
        escaped_key = key.replace('\\', '\\\\').replace('"', '\\"')
        script = f'''
        {activate_cmd}
        tell application "System Events" to keystroke "{escaped_key}"{using_clause}
        '''

    logger.info(f"⌨️ Sys Key: {key} + {modifiers}")
    try:
        res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=10)
        if res.returncode != 0:
            return {"error": f"AppleScript error: {res.stderr.strip()}"}
        return {"message": f"Pressed key '{key}' with {modifiers}"}
    except Exception as e:
        return {"error": str(e)}


def tool_sys_mouse(args: Dict[str, Any]) -> Dict[str, Any]:
    """Physically move the actual OS mouse and click at (x, y) coordinates.
    Actions: click, double_click, triple_click, right_click, drag, move, scroll_up, scroll_down
    """
    x = args.get("x")
    y = args.get("y")
    action = args.get("action") or "click"

    if x is None or y is None:
        return {"error": "x and y coordinates are required"}

    try:
        x, y = float(x), float(y)
        import ctypes
        import time
        CG = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')

        kCGEventMouseMoved = 5
        kCGEventLeftMouseDown = 1
        kCGEventLeftMouseUp = 2
        kCGEventRightMouseDown = 3
        kCGEventRightMouseUp = 4
        kCGEventLeftMouseDragged = 6
        kCGEventScrollWheel = 22
        kCGMouseButtonLeft = 0
        kCGMouseButtonRight = 1
        kCGHIDEventTap = 0

        class CGPoint(ctypes.Structure):
            _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

        CG.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32]
        CG.CGEventCreateMouseEvent.restype = ctypes.c_void_p
        CG.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
        CG.CGEventSetType.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        CG.CGEventSetIntegerValueField = getattr(CG, 'CGEventSetIntegerValueField', None)
        if CG.CGEventSetIntegerValueField:
            CG.CGEventSetIntegerValueField.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int64]

        pt = CGPoint(x, y)

        def _click_once():
            """Single left click with fresh events."""
            ev_down = CG.CGEventCreateMouseEvent(None, kCGEventLeftMouseDown, pt, kCGMouseButtonLeft)
            CG.CGEventPost(kCGHIDEventTap, ev_down)
            time.sleep(0.05)
            ev_up = CG.CGEventCreateMouseEvent(None, kCGEventLeftMouseUp, pt, kCGMouseButtonLeft)
            CG.CGEventPost(kCGHIDEventTap, ev_up)

        # Move mouse to position
        move_event = CG.CGEventCreateMouseEvent(None, kCGEventMouseMoved, pt, kCGMouseButtonLeft)
        CG.CGEventPost(kCGHIDEventTap, move_event)
        time.sleep(0.05)

        if action == "move":
            pass  # Just move, no click

        elif action == "click":
            _click_once()

        elif action == "double_click":
            _click_once()
            time.sleep(0.05)
            _click_once()

        elif action == "triple_click":
            _click_once()
            time.sleep(0.05)
            _click_once()
            time.sleep(0.05)
            _click_once()

        elif action == "right_click":
            ev_down = CG.CGEventCreateMouseEvent(None, kCGEventRightMouseDown, pt, kCGMouseButtonRight)
            CG.CGEventPost(kCGHIDEventTap, ev_down)
            time.sleep(0.05)
            ev_up = CG.CGEventCreateMouseEvent(None, kCGEventRightMouseUp, pt, kCGMouseButtonRight)
            CG.CGEventPost(kCGHIDEventTap, ev_up)

        elif action == "drag":
            drag_x = float(args.get("drag_to_x", x))
            drag_y = float(args.get("drag_to_y", y))
            drag_pt = CGPoint(drag_x, drag_y)
            ev_down = CG.CGEventCreateMouseEvent(None, kCGEventLeftMouseDown, pt, kCGMouseButtonLeft)
            CG.CGEventPost(kCGHIDEventTap, ev_down)
            time.sleep(0.1)
            ev_drag = CG.CGEventCreateMouseEvent(None, kCGEventLeftMouseDragged, drag_pt, kCGMouseButtonLeft)
            CG.CGEventPost(kCGHIDEventTap, ev_drag)
            time.sleep(0.2)
            ev_up = CG.CGEventCreateMouseEvent(None, kCGEventLeftMouseUp, drag_pt, kCGMouseButtonLeft)
            CG.CGEventPost(kCGHIDEventTap, ev_up)

        elif action in ("scroll_up", "scroll_down"):
            # Scroll via CGEventCreateScrollWheelEvent
            scroll_amount = int(args.get("amount", 3))
            if action == "scroll_down":
                scroll_amount = -scroll_amount
            try:
                CG.CGEventCreateScrollWheelEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_int32]
                CG.CGEventCreateScrollWheelEvent.restype = ctypes.c_void_p
                kCGScrollEventUnitLine = 1
                scroll_ev = CG.CGEventCreateScrollWheelEvent(None, kCGScrollEventUnitLine, 1, scroll_amount)
                CG.CGEventPost(kCGHIDEventTap, scroll_ev)
            except Exception:
                # Fallback: use AppleScript
                direction = "up" if action == "scroll_up" else "down"
                for _ in range(abs(scroll_amount)):
                    subprocess.run(["osascript", "-e",
                        f'tell application "System Events" to key code {126 if direction == "up" else 125}'],
                        capture_output=True, timeout=5)

        else:
            return {"error": f"Unknown action: {action}. Use: click, double_click, triple_click, right_click, drag, move, scroll_up, scroll_down"}

        logger.info(f"🖱️ Sys Mouse: {action} at ({x}, {y})")
        return {"message": f"Successfully performed '{action}' at x={x}, y={y}"}
    except Exception as e:
        return {"error": f"Mouse action failed: {str(e)}"}


def tool_sys_type(args: Dict[str, Any]) -> Dict[str, Any]:
    """Physically type text on the OS.

    Modes:
    - Default: clipboard paste (Cmd+V) — fast, works with any text including Vietnamese.
    - telex=true: type character by character via AppleScript keystroke.
      This lets the system Telex IME compose Vietnamese (e.g. "vieetj" → "việt").
      Use this when the user is using Telex input method and wants the IME to process.
    """
    import time as _time
    text = args.get("text") or ""
    if not text:
        return {"error": "text is required"}

    app_focus = args.get("app") or args.get("browser") or ""
    use_telex = bool(args.get("telex"))
    logger.info(f"⌨️ Sys Type: {text[:60]!r} (telex={use_telex})")

    activate_cmd = f'tell application "{app_focus}" to activate' if app_focus else ""

    # Telex mode: type each character individually so IME can compose
    if use_telex:
        try:
            if activate_cmd:
                subprocess.run(["osascript", "-e", activate_cmd], capture_output=True, timeout=5)
                _time.sleep(0.15)

            for ch in text:
                if ch == "\n":
                    subprocess.run(["osascript", "-e",
                        'tell application "System Events" to key code 36'],
                        capture_output=True, timeout=5)
                else:
                    escaped = ch.replace('\\', '\\\\').replace('"', '\\"')
                    subprocess.run(["osascript", "-e",
                        f'tell application "System Events" to keystroke "{escaped}"'],
                        capture_output=True, timeout=5)
                _time.sleep(0.02)  # Small delay for IME processing

            return {"message": f"Typed (telex): {text[:40]}"}
        except Exception as e:
            return {"error": str(e)}

    # Detect whether text is pure ASCII
    try:
        text.encode("ascii")
        is_ascii = True
    except UnicodeEncodeError:
        is_ascii = False

    if is_ascii:
        # Fast path: use AppleScript keystroke
        escaped_text = text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\r")
        script = f'''
{activate_cmd}
tell application "System Events"
    keystroke "{escaped_text}"
end tell
'''
        try:
            res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=15)
            if res.returncode != 0:
                return {"error": f"AppleScript error: {res.stderr.strip()}"}
            return {"message": f"Typed: {text[:40]}"}
        except Exception as e:
            return {"error": str(e)}
    else:
        # Non-ASCII path: clipboard paste (Cmd+V)
        try:
            pbcopy_res = subprocess.run(
                ["pbcopy"],
                input=text.encode("utf-8"),
                capture_output=True,
                timeout=5,
            )
            if pbcopy_res.returncode != 0:
                return {"error": f"pbcopy failed: {pbcopy_res.stderr}"}

            if activate_cmd:
                subprocess.run(["osascript", "-e", activate_cmd], capture_output=True, timeout=5)
                _time.sleep(0.15)

            paste_script = 'tell application "System Events" to keystroke "v" using command down'
            res = subprocess.run(["osascript", "-e", paste_script], capture_output=True, text=True, timeout=10)
            if res.returncode != 0:
                return {"error": f"Paste failed: {res.stderr.strip()}"}
            return {"message": f"Typed (via clipboard): {text[:40]}"}
        except Exception as e:
            return {"error": str(e)}


def tool_fb_message(args: Dict[str, Any]) -> Dict[str, Any]:
    """Send a Facebook message. Handles the entire flow automatically:
    Opens messenger, searches contact, clicks, types message, sends.
    """
    import time as _t

    contact = (args.get("contact") or "").strip()
    message = (args.get("message") or "").strip()
    browser = args.get("browser") or _active_browser

    if not contact:
        return {"error": "contact name is required"}
    if not message:
        return {"error": "message is required"}

    logger.info(f"💬 FB Message: '{message[:40]}' → contact '{contact}'")
    steps_log = []

    def _activate():
        subprocess.run(["osascript", "-e", f'tell application "{browser}" to activate'],
                       capture_output=True, timeout=3)
        _t.sleep(0.3)

    def _physical_click_element(js_find_expr):
        """Get coords of element and physically click it."""
        import json as _j
        js = f'''(function(){{
            var el = {js_find_expr};
            if(!el) return "null";
            el.scrollIntoView({{block:"center",inline:"center"}});
            var r = el.getBoundingClientRect();
            var toolbarH = window.outerHeight - window.innerHeight;
            return JSON.stringify({{
                x: Math.round(r.left + window.screenX + r.width/2),
                y: Math.round(r.top + toolbarH + window.screenY + r.height/2)
            }});
        }})()'''
        res = tool_browser_js({"script": js, "browser": browser})
        s = res.get("result", "").strip()
        if s and s != "null":
            try:
                c = _j.loads(s)
                tool_sys_mouse({"x": c["x"], "y": c["y"], "action": "click"})
                return True
            except Exception:
                pass
        return False

    def _type_physical(text):
        """Type text using physical keyboard (clipboard for non-ASCII)."""
        _activate()
        _t.sleep(0.1)
        tool_sys_type({"text": text, "app": browser})
        _t.sleep(0.3)

    def _press_key(key):
        _activate()
        tool_sys_key({"key": key, "app": browser})
        _t.sleep(0.3)

    # Step 1: Open Facebook Messenger
    steps_log.append("Opening facebook.com/messages...")
    tool_open_browser({"url": "https://www.facebook.com/messages/t/", "browser": browser})
    _t.sleep(3)  # Facebook loads slow

    # Step 2: Activate Chrome
    _activate()

    # Step 3: Find and click the search/new message area
    # Facebook Messenger has a search input or "New message" button
    steps_log.append(f"Searching for contact: {contact}")

    # Try clicking the search box using Cmd+/ (Facebook shortcut for search)
    # Or find the search input
    js_find_search = '''(function(){
        // Try multiple selectors for FB Messenger search
        var selectors = [
            'input[placeholder*="Search"]',
            'input[placeholder*="Tìm"]',
            'input[placeholder*="search"]',
            'input[aria-label*="Search"]',
            'input[aria-label*="Tìm"]',
            '[role="search"] input',
            'input[type="search"]'
        ];
        for(var i=0; i<selectors.length; i++){
            var el = document.querySelector(selectors[i]);
            if(el) { el.scrollIntoView({block:"center"}); return "found"; }
        }
        return "not_found";
    })()'''

    search_res = tool_browser_js({"script": js_find_search, "browser": browser})

    if search_res.get("result") == "found":
        # Click the found search box
        js_click_search = '''(function(){
            var selectors = [
                'input[placeholder*="Search"]', 'input[placeholder*="Tìm"]',
                'input[placeholder*="search"]', 'input[aria-label*="Search"]',
                'input[aria-label*="Tìm"]', '[role="search"] input', 'input[type="search"]'
            ];
            for(var i=0; i<selectors.length; i++){
                var el = document.querySelector(selectors[i]);
                if(el) return el;
            }
            return null;
        })()'''
        _physical_click_element('''(function(){
            var selectors = [
                'input[placeholder*="Search"]', 'input[placeholder*="Tìm"]',
                'input[placeholder*="search"]', 'input[aria-label*="Search"]',
                'input[aria-label*="Tìm"]', '[role="search"] input', 'input[type="search"]'
            ];
            for(var i=0; i<selectors.length; i++){
                var el = document.querySelector(selectors[i]);
                if(el) return el;
            }
            return null;
        })()''')
    else:
        # Fallback: use Cmd+/ shortcut (Facebook search shortcut)
        _press_key("/")

    _t.sleep(0.5)

    # Step 4: Type contact name
    _type_physical(contact)
    _t.sleep(2)  # Wait for search results to appear

    # Step 5: Click the first matching contact in search results
    steps_log.append("Clicking contact from search results...")
    js_find_contact = f'''(function(){{
        // Find clickable elements containing the contact name
        var links = document.querySelectorAll('a[role="link"], a[href*="/t/"], [role="option"], [role="row"], li[role="listitem"], [data-testid] a');
        for(var i=0; i<links.length; i++){{
            var txt = links[i].innerText || links[i].textContent || "";
            if(txt.toLowerCase().includes("{contact.lower()}")){{
                return links[i];
            }}
        }}
        // Broader search: any element with matching text
        var all = document.querySelectorAll('span, div, a');
        for(var i=0; i<all.length; i++){{
            var el = all[i];
            var txt = (el.innerText || "").trim();
            if(txt.toLowerCase().includes("{contact.lower()}") && txt.length < 100){{
                // Find clickable parent
                var clickable = el.closest('a') || el.closest('[role="row"]') || el.closest('[role="option"]') || el;
                return clickable;
            }}
        }}
        return null;
    }})()'''

    clicked = _physical_click_element(js_find_contact)
    if not clicked:
        # Try pressing Down arrow + Enter as fallback
        steps_log.append("Direct click failed, trying keyboard navigation...")
        _press_key("down")
        _t.sleep(0.3)
        _press_key("return")

    _t.sleep(2)  # Wait for chat to load

    # Step 6: Click the message input box
    steps_log.append("Clicking message input...")
    js_find_msg_box = '''(function(){
        var selectors = [
            '[contenteditable="true"][role="textbox"]',
            '[contenteditable="true"][aria-label*="message"]',
            '[contenteditable="true"][aria-label*="tin nhắn"]',
            '[contenteditable="true"][aria-label*="Message"]',
            '[contenteditable="true"][aria-label*="Nhắn"]',
            'div[role="textbox"]',
            'p[data-lexical-text]',
            '[contenteditable="true"]'
        ];
        for(var i=0; i<selectors.length; i++){
            var el = document.querySelector(selectors[i]);
            if(el) return el;
        }
        return null;
    })()'''

    clicked_msg = _physical_click_element(js_find_msg_box)
    if not clicked_msg:
        steps_log.append("Could not find message box!")
        return {"error": "Could not find message input box on Facebook", "steps": steps_log}

    _t.sleep(0.3)

    # Step 7: Type the message
    steps_log.append(f"Typing message: {message[:40]}...")
    _type_physical(message)
    _t.sleep(0.3)

    # Step 8: Press Enter to send
    steps_log.append("Pressing Enter to send...")
    _press_key("return")
    _t.sleep(0.5)

    steps_log.append("Message sent!")
    logger.info(f"✅ FB message sent to '{contact}': '{message[:40]}'")
    return {
        "message": f"Đã gửi tin nhắn '{message[:40]}' cho '{contact}' trên Facebook Messenger.",
        "steps": steps_log,
    }


def tool_add_knowledge(args: Dict[str, Any]) -> Dict[str, Any]:
    """Add information to RAG knowledge base."""
    from core.memory import MemoryManager
    topic = args.get("topic") or "general"
    content = args.get("content") or ""
    return MemoryManager.get().add_knowledge(topic, content)


def tool_query_knowledge(args: Dict[str, Any]) -> Dict[str, Any]:
    """Query information from RAG knowledge base."""
    from core.memory import MemoryManager
    topic = args.get("topic") or ""
    query = args.get("query") or ""
    n_results = int(args.get("n_results") or 3)
    if not topic:
        return {"results": MemoryManager.get().query_all_knowledge(query, n_results)}
    return MemoryManager.get().query_knowledge(topic, query, n_results)


def tool_session_query(args: Dict[str, Any]) -> Dict[str, Any]:
    """Smart knowledge query: searches session-specific data first, falls back to global knowledge.
    
    This tool checks the current session's indexed data (from deep_search, read_web, etc.).
    If the session has no data yet (new session), it automatically searches ALL knowledge topics
    so the user always gets relevant results.
    """
    from core.memory import MemoryManager
    query = args.get("query") or ""
    n = int(args.get("n") or 5)
    
    if not query:
        return {"error": "query is required"}
    
    memory = MemoryManager.get()
    topic = _get_session_topic()
    
    # 1. Try session-specific data first
    session_result = memory.query_knowledge(topic, query, n_results=n)
    
    # If session has results, return them
    if "results" in session_result and session_result["results"]:
        session_result["source"] = "session"
        return session_result
    
    # 2. Session is empty → fall back to global knowledge base
    logger.info(f"🔄 Session '{topic}' empty, falling back to global knowledge for query: {query[:60]}")
    global_results = memory.query_all_knowledge(query, n_results=n)
    
    if global_results:
        formatted = [r["content"] for r in global_results]
        distances = [r.get("distance", 0.0) for r in global_results]
        topics_found = list(set(r.get("topic", "unknown") for r in global_results))
        return {
            "results": formatted,
            "distances": distances,
            "source": "global_knowledge",
            "topics": topics_found,
            "message": f"Phiên hiện tại chưa có dữ liệu. Đã tìm {len(formatted)} kết quả từ knowledge base toàn cục (topics: {', '.join(topics_found)})."
        }
    
    # 3. Nothing found anywhere
    return {
        "message": f"Không tìm thấy dữ liệu nào cho query '{query}'. Hãy dùng deep_search để tìm kiếm thông tin trước.",
        "source": "none",
        "suggestion": "Use deep_search{query} to find and index information first, then session_query to retrieve it."
    }


def tool_clear_session_rag(args: Dict[str, Any]) -> Dict[str, Any]:
    """Completely wipe the temporary RAG memory for this session."""
    from core.memory import MemoryManager
    topic = _get_session_topic()
    return MemoryManager.get().delete_topic(topic)


def tool_remember(args: Dict[str, Any]) -> Dict[str, Any]:
    """Save an observation, preference, or lesson to long-term memory.
    
    Args:
        content: the thing to remember
        type: "lesson" | "preference" | "knowledge" (default: "knowledge")
        topic: optional category
    """
    from core.memory import MemoryManager
    content = (args.get("content") or "").strip()
    type_ = args.get("type") or args.get("memory_type") or "knowledge"
    topic = args.get("topic") or type_
    
    if not content:
        return {"error": "content is required"}
        
    memory = MemoryManager.get()
    try:
        if type_ == "preference":
            if ":" in content:
                k, v = content.split(":", 1)
                memory.update_preferences(k.strip(), v.strip())
            else:
                memory.update_preferences(topic, content)
        elif type_ == "lesson":
            memory.add_knowledge("lessons", content, source="agent_observation")
        else:
            memory.add_knowledge(topic, content, source="agent_observation")
        
        return {
            "message": f"✅ Remembered as {type_}: {content[:100]}...",
            "type": type_,
            "topic": topic,
        }
    except Exception as e:
        return {"error": f"Failed to remember: {e}"}


def tool_clear_knowledge(args: Dict[str, Any]) -> Dict[str, Any]:
    from core.memory import MemoryManager
    topic = args.get("topic", "")
    if topic:
        return MemoryManager.get().delete_topic(topic)
    return {"error": "topic is required for clear_knowledge"}


_SCRATCHPAD_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "scratchpad.md")

def tool_scratchpad(args: Dict[str, Any]) -> Dict[str, Any]:
    """Agent working memory — persists across context trims."""
    from core.memory import MemoryManager
    memory = MemoryManager.get()
    action = args.get("action") or "read"
    content = args.get("content") or ""

    if action == "write" or action == "save_progress":
        if not content:
            return {"error": "content is required for write"}
        memory.write_scratchpad(content)
        return {"message": f"Saved to scratchpad: {content[:80]}"}

    elif action == "read":
        text = memory.get_scratchpad()
        if not text:
            return {"content": "(empty)", "message": "Scratchpad is empty."}
        # Return last 2000 chars to avoid huge payloads
        if len(text) > 2000:
            text = "...(earlier entries trimmed)...\n" + text[-2000:]
        return {"content": text, "message": f"Scratchpad: {len(text)} chars"}

    elif action == "clear":
        memory.clear_scratchpad()
        return {"message": "Scratchpad cleared."}

    return {"error": f"Unknown action: {action}. Use write, read, or clear."}


def _read_scratchpad() -> str:
    """Read scratchpad for injection into context (used by executor)."""
    from core.memory import MemoryManager
    text = MemoryManager.get().get_scratchpad().strip()
    if len(text) > 1500:
        text = "...(earlier trimmed)...\n" + text[-1500:]
    return text


def tool_get_current_time(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get the exact current date and time."""
    import datetime
    now = datetime.datetime.now()
    return {
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M:%S"),
        "datetime": now.strftime("%Y-%m-%d %H:%M:%S"),
        "day_of_week": now.strftime("%A")
    }


def tool_excel_python(args: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a Python script optimized for Excel manipulation via xlwings."""
    script = args.get("script") or ""
    if not script:
        return {"error": "script is required"}
        
    logger.info("📊 Running Excel Python Script (xlwings)")
    import tempfile
    
    # Prepend some common imports to make it easier for the model
    full_script = f"""
import xlwings as xw
import pandas as pd
import time
import sys

{script}
"""
    
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(full_script)
            temp_path = f.name
            
        import sys
        env = os.environ.copy()
        result = subprocess.run(
            [sys.executable, temp_path],
            capture_output=True, text=True, timeout=120,
            env=env
        )
        if os.path.exists(temp_path):
            os.remove(temp_path)
            
        return {
            "stdout": result.stdout[:8000],
            "stderr": result.stderr[:4000],
            "exit_code": result.returncode,
            "message": "Script executed successfully" if result.returncode == 0 else "Script failed"
        }
    except subprocess.TimeoutExpired:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        return {"error": "Excel python script timed out (120s)"}
    except Exception as e:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        return {"error": f"Failed to run Excel python script: {str(e)}"}








def tool_sys_get_active_app(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get the name of the frontmost (active) application on macOS."""
    script = 'tell application "System Events" to get name of first application process whose frontmost is true'
    try:
        res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=5)
        name = res.stdout.strip()
        logger.info(f"📍 Active App: {name}")
        return {"app": name, "message": f"Ứng dụng hiện tại là {name}"}
    except Exception as e:
        return {"error": f"Failed to get active app: {str(e)}"}


def tool_browser_wait(args: Dict[str, Any]) -> Dict[str, Any]:
    """Wait for page to load and trigger lazy loading by scrolling.

    Useful for e-commerce sites like Shopee that load content dynamically.
    """
    import time as _time
    seconds = args.get("seconds", 3)
    browser = args.get("browser", _active_browser)

    try:
        seconds = int(seconds)
        seconds = max(1, min(seconds, 30))  # Cap 1-30s
    except Exception:
        seconds = 3

    logger.info(f"⏳ Browser wait: {seconds}s + auto-scroll for lazy loading")

    # Wait for initial load
    _time.sleep(seconds)

    # Auto-scroll to trigger lazy loading (Shopee, etc.)
    scroll_js = """
    (function() {
        var scrollCount = 0;
        var maxScrolls = 5;
        var scrollInterval = setInterval(function() {
            window.scrollBy(0, window.innerHeight / 2);
            scrollCount++;
            if (scrollCount >= maxScrolls) {
                clearInterval(scrollInterval);
            }
        }, 100);
        return 'Scrolled ' + maxScrolls + ' times';
    })()
    """

    scroll_res = tool_browser_js({"script": scroll_js, "browser": browser})
    _time.sleep(1)

    return {
        "message": f"Waited {seconds}s + triggered lazy loading",
        "scroll_result": scroll_res.get("result", ""),
    }


def tool_browser_extract(args: Dict[str, Any]) -> Dict[str, Any]:
    """Extract text/href/src from specific CSS selector on current page.

    If selector doesn't match, tries fallback selectors (for robustness).
    """
    selector = args.get("selector", "")
    attribute = args.get("attribute", "text").lower()
    browser = args.get("browser", _active_browser)

    if not selector:
        return {"error": "selector is required"}

    if attribute not in ("text", "href", "src"):
        attribute = "text"

    logger.info(f"🔍 Browser extract: {attribute} from '{selector}'")

    selector_escaped = selector.replace("'", "\\'").replace('"', '\\"')

    # Try primary selector + fallback selectors
    import json as _json
    selectors_to_try = [selector_escaped]

    # If user tries common but wrong selectors, add fallbacks
    if "product" in selector.lower():
        selectors_to_try.extend([
            "[class*='product']",
            "div[class*='product']",
            "[data-product]",
            ".product-item",
            ".shopee-product-item",
        ])
    if "name" in selector.lower():
        selectors_to_try.extend([
            "[class*='name']",
            "span[class*='title']",
            "[class*='title']",
        ])

    selectors_json = _json.dumps(selectors_to_try)
    js_code = f"""
    (function() {{
        var selectors = {selectors_json};
        var results = [];
        var attr = '{attribute}';

        for(var sel of selectors) {{
            try {{
                var els = document.querySelectorAll(sel);
                if(els.length > 0) {{
                    for(var i = 0; i < Math.min(els.length, 100); i++) {{
                        if(attr === 'text') {{
                            var txt = (els[i].innerText || els[i].textContent || '').trim();
                            if(txt && results.indexOf(txt) < 0) results.push(txt);
                        }} else {{
                            var val = els[i].getAttribute(attr) || '';
                            if(val && results.indexOf(val) < 0) results.push(val);
                        }}
                    }}
                    if(results.length > 0) break;  // Found results, stop trying other selectors
                }}
            }} catch(e) {{}}
        }}

        return JSON.stringify({{
            results: results.slice(0, 50),
            count: results.length,
            matched_selector: selectors[0]
        }});
    }})()
    """

    res = tool_browser_js({"script": js_code, "browser": browser})
    result_str = res.get("result", "{}").strip()

    try:
        data = _json.loads(result_str)
        results = data.get("results", [])
        count = data.get("count", 0)

        if count == 0:
            return {
                "error": f"No elements found for selector '{selector}' or fallbacks",
                "selector_tried": selector,
                "suggestion": "Try using browser_read first to see available elements"
            }

        return {
            "selector": selector,
            "attribute": attribute,
            "count": count,
            "results": results,
            "message": f"✅ Extracted {count} items"
        }
    except Exception as e:
        return {
            "error": f"Failed to parse results: {str(e)}",
            "raw": result_str[:200],
        }


def tool_browser_extract_prices(args: Dict[str, Any]) -> Dict[str, Any]:
    """Smart price extraction from e-commerce pages (Shopee, Lazada, etc).

    Automatically finds and parses price elements with currency symbols.
    Multiple strategies: element selectors, data attributes, page text regex.
    """
    browser = args.get("browser", _active_browser)

    logger.info(f"💰 Browser extract prices from page")

    # Comprehensive JS with multiple fallback strategies
    js = """
    (function() {
        var found = new Set();

        // Strategy 1: Common CSS selectors for e-commerce
        var selectors = [
            '[data-price]', '[data-original-price]',
            '.price', '.product-price', '.original-price',
            '.shopee-price-display', '.shopee-product-price',
            '.lazada-price-tag', '.lazada-price',
            '[class*="price"]', '[class*="Price"]',
            'span[class*="price"]', 'div[class*="price"]',
            '[class*="amount"]', '[class*="Amount"]',
            'strong[class*="price"]', 'b[class*="price"]',
        ];

        for(var s of selectors) {
            try {
                var els = document.querySelectorAll(s);
                for(var i = 0; i < Math.min(els.length, 200); i++) {
                    var text = (els[i].innerText || els[i].textContent || els[i].getAttribute('data-price') || '').trim();
                    if(!text) continue;

                    // Match: 123.456,78 or 1,234,567 or 123456
                    var priceMatches = text.match(/[₫$€¥₹₽]?\\s*[0-9]{1,3}(?:[,.][0-9]{3})*(?:[,.][0-9]{2})?\\s*[₫$€¥₹₽]?/g);
                    if(priceMatches) {
                        for(var p of priceMatches) {
                            var clean = p.trim();
                            if(clean.length > 2) found.add(clean);
                        }
                    }
                }
            } catch(e) {}
        }

        // Strategy 2: Full page text with aggressive regex (get top numbers)
        var pageText = document.body.innerText || '';
        var lines = pageText.split('\\n');
        for(var line of lines) {
            // Match prices: 1,234,567 or 123.456 with optional currency
            var matches = line.match(/[0-9]{2,}[0-9,.]*/g) || [];
            for(var m of matches) {
                // Must have comma or dot (likely price formatting)
                if((m.indexOf(',') >= 0 || m.indexOf('.') >= 0) && m.length > 3) {
                    found.add(m.trim());
                }
            }
        }

        // Strategy 3: Look for text patterns like "₫ 123456" or "$99.99"
        var currencyRegex = /[₫$€¥₹₽]\\s*[0-9,.]*/g;
        var currencyMatches = pageText.match(currencyRegex) || [];
        for(var m of currencyMatches) {
            var clean = m.trim();
            if(clean.length > 2) found.add(clean);
        }

        // Remove duplicates and sort by length (longer = more likely real price)
        var result = Array.from(found)
            .filter(x => x && x.match(/[0-9]{2,}/))
            .sort((a, b) => b.length - a.length)
            .slice(0, 30);

        return JSON.stringify({
            count: result.length,
            prices: result,
            page_length: pageText.length
        });
    })()
    """

    res = tool_browser_js({"script": js, "browser": browser})
    result_str = res.get("result", "{}").strip()

    try:
        import json as _json
        data = _json.loads(result_str)
        count = data.get("count", 0)
        prices = data.get("prices", [])

        if count == 0:
            return {
                "message": "No prices found on page. Try taking screenshot to see if data loaded.",
                "prices": [],
                "debug": f"Page size: {data.get('page_length', 0)} chars",
            }

        return {
            "message": f"✅ Found {count} price values on page",
            "prices": prices,
            "count": count,
        }
    except Exception as e:
        return {
            "error": f"Failed to parse price extraction result: {str(e)}",
            "raw": result_str[:300],
        }


CLAUDE_CLI = "/Users/nguyenhat/.local/bin/claude"


def tool_claude_code(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delegate tasks to Claude Code CLI for autonomous coding.

    Actions:
    - prompt: Send prompt to Claude Code, get result back (main action)
    - edit: Edit a specific file with instruction
    - review: Review code in a directory
    """
    action = args.get("action") or "prompt"
    logger.info(f"🤖 Claude Code: {action}")

    # Common flags for autonomous operation
    base_flags = [CLAUDE_CLI, "-p", "--permission-mode", "bypassPermissions"]

    try:
        if action == "prompt":
            prompt = args.get("prompt", "")
            if not prompt:
                return {"error": "prompt is required"}

            cwd = args.get("cwd", os.path.expanduser("~/Public/hatai-remote"))
            model = args.get("model", "")

            cmd = base_flags + [prompt]
            if model:
                cmd.extend(["--model", model])

            result = subprocess.run(
                cmd, capture_output=True, text=True,
                cwd=cwd, timeout=300,
                env={**os.environ, "CLAUDE_CODE_SIMPLE": "1"},
            )

            return {
                "action": "prompt",
                "stdout": result.stdout[:4000],
                "stderr": result.stderr[:1000],
                "exit_code": result.returncode,
                "success": result.returncode == 0,
            }

        elif action == "edit":
            path = args.get("path", "")
            instruction = args.get("instruction", "")
            if not path or not instruction:
                return {"error": "path and instruction required"}

            prompt = f"Edit the file {path}: {instruction}. Only modify what's needed, keep the rest."
            cwd = os.path.dirname(os.path.abspath(path)) if os.path.exists(path) else os.path.expanduser("~")

            result = subprocess.run(
                base_flags + [prompt],
                capture_output=True, text=True,
                cwd=cwd, timeout=300,
                env={**os.environ, "CLAUDE_CODE_SIMPLE": "1"},
            )

            return {
                "action": "edit",
                "path": path,
                "stdout": result.stdout[:4000],
                "stderr": result.stderr[:1000],
                "exit_code": result.returncode,
                "success": result.returncode == 0,
            }

        elif action == "review":
            path = args.get("path", os.path.expanduser("~/Public/hatai-remote"))
            focus = args.get("focus", "bugs, security, performance")

            prompt = f"Review the code in this project. Focus on: {focus}. List the top issues with file paths and line numbers."

            result = subprocess.run(
                base_flags + [prompt],
                capture_output=True, text=True,
                cwd=path, timeout=300,
                env={**os.environ, "CLAUDE_CODE_SIMPLE": "1"},
            )

            return {
                "action": "review",
                "path": path,
                "stdout": result.stdout[:4000],
                "stderr": result.stderr[:1000],
                "exit_code": result.returncode,
                "success": result.returncode == 0,
            }

        else:
            return {"error": f"Unknown action: {action}. Use: prompt|edit|review"}

    except subprocess.TimeoutExpired:
        return {"error": f"Claude Code timed out (5min) for: {action}"}
    except FileNotFoundError:
        return {"error": f"Claude CLI not found at {CLAUDE_CLI}"}
    except Exception as e:
        return {"error": f"Claude Code error: {str(e)}"}


AGY_CLI = "/Users/nguyenhat/.antigravity/antigravity/bin/antigravity"


def tool_antigravity(args: Dict[str, Any]) -> Dict[str, Any]:
    """Control Google Antigravity IDE via CLI and GUI automation.

    Actions:
    - open_file: Open file in editor (path, line?, col?)
    - open_folder: Open project folder (path)
    - new_file: Create new file with code via GUI (code, filename?)
    - diff: Compare two files side-by-side (file1, file2)
    - goto: Jump to file:line:col (target e.g. "main.py:42:5")
    - list_extensions: List installed extensions
    - install_extension: Install extension by ID (ext_id)
    - uninstall_extension: Remove extension (ext_id)
    - add_mcp: Add MCP server (mcp_json — JSON string)
    - run_terminal: Run command in Antigravity integrated terminal (command, cwd?)
    - ai_edit: Use Antigravity AI to edit a file (path, instruction)
    """
    action = args.get("action") or ""
    if not action:
        return {"error": "action is required (open_file|open_folder|new_file|diff|goto|list_extensions|install_extension|uninstall_extension|add_mcp|run_terminal|ai_edit|ai_inline)"}

    logger.info(f"🚀 Antigravity action: {action}")

    try:
        if action == "open_file":
            path = args.get("path", "")
            if not path:
                return {"error": "path is required"}
            line = args.get("line")
            col = args.get("col")
            target = path
            if line:
                target = f"{path}:{line}"
                if col:
                    target = f"{path}:{line}:{col}"
            result = subprocess.run(
                [AGY_CLI, "-g", target],
                capture_output=True, text=True, timeout=15,
            )
            return {
                "action": "open_file",
                "path": target,
                "exit_code": result.returncode,
                "message": f"Opened {target} in Antigravity",
            }

        elif action == "open_folder":
            path = args.get("path", "")
            if not path:
                return {"error": "path is required"}
            new_window = args.get("new_window", False)
            cmd = [AGY_CLI]
            if new_window:
                cmd.append("-n")
            cmd.append(path)
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            return {
                "action": "open_folder",
                "path": path,
                "exit_code": result.returncode,
                "message": f"Opened folder {path} in Antigravity",
            }

        elif action == "new_file":
            # GUI approach: open app → Cmd+N → type code → optionally save
            code = args.get("code", "")
            filename = args.get("filename", "")
            if not code:
                return {"error": "code is required for new_file"}

            import time as _time
            logger.info(f"📝 Antigravity new_file: {len(code)} chars")

            # If filename provided, write via filesystem then open — much faster and more reliable
            if filename:
                # Determine full path
                if not os.path.isabs(filename):
                    filename = os.path.join(os.path.expanduser("~"), filename)
                os.makedirs(os.path.dirname(filename), exist_ok=True)
                with open(filename, "w", encoding="utf-8") as f:
                    f.write(code)
                subprocess.run([AGY_CLI, filename], capture_output=True, text=True, timeout=15)
                return {
                    "action": "new_file",
                    "path": filename,
                    "chars": len(code),
                    "message": f"Created {filename} and opened in Antigravity",
                }

            # No filename — use GUI typing
            tool_sys_open_app({"app_name": "Antigravity"})
            _time.sleep(2)
            tool_sys_key({"key": "n", "modifiers": ["command"]})
            _time.sleep(0.5)
            tool_sys_type({"text": code})
            return {
                "action": "new_file",
                "chars": len(code),
                "message": f"Typed {len(code)} chars into new Antigravity tab",
            }

        elif action == "diff":
            file1 = args.get("file1", "")
            file2 = args.get("file2", "")
            if not file1 or not file2:
                return {"error": "file1 and file2 are required"}
            result = subprocess.run(
                [AGY_CLI, "-d", file1, file2],
                capture_output=True, text=True, timeout=15,
            )
            return {
                "action": "diff",
                "file1": file1,
                "file2": file2,
                "exit_code": result.returncode,
                "message": f"Opened diff view: {file1} vs {file2}",
            }

        elif action == "goto":
            target = args.get("target", "")
            if not target:
                return {"error": "target is required (e.g. 'file.py:42:5')"}
            result = subprocess.run(
                [AGY_CLI, "-g", target],
                capture_output=True, text=True, timeout=15,
            )
            return {
                "action": "goto",
                "target": target,
                "exit_code": result.returncode,
                "message": f"Jumped to {target}",
            }

        elif action == "list_extensions":
            result = subprocess.run(
                [AGY_CLI, "--list-extensions", "--show-versions"],
                capture_output=True, text=True, timeout=30,
            )
            exts = [l.strip() for l in result.stdout.strip().split("\n") if l.strip() and not l.startswith("[")]
            return {
                "action": "list_extensions",
                "extensions": exts,
                "count": len(exts),
                "exit_code": result.returncode,
            }

        elif action == "install_extension":
            ext_id = args.get("ext_id", "")
            if not ext_id:
                return {"error": "ext_id is required (e.g. 'ms-python.python')"}
            pre_release = args.get("pre_release", False)
            cmd = [AGY_CLI, "--install-extension", ext_id]
            if pre_release:
                cmd.append("--pre-release")
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            return {
                "action": "install_extension",
                "ext_id": ext_id,
                "stdout": result.stdout[:2000],
                "stderr": result.stderr[:1000],
                "exit_code": result.returncode,
                "success": result.returncode == 0,
            }

        elif action == "uninstall_extension":
            ext_id = args.get("ext_id", "")
            if not ext_id:
                return {"error": "ext_id is required"}
            result = subprocess.run(
                [AGY_CLI, "--uninstall-extension", ext_id],
                capture_output=True, text=True, timeout=60,
            )
            return {
                "action": "uninstall_extension",
                "ext_id": ext_id,
                "stdout": result.stdout[:2000],
                "exit_code": result.returncode,
                "success": result.returncode == 0,
            }

        elif action == "add_mcp":
            mcp_json = args.get("mcp_json", "")
            if not mcp_json:
                return {"error": "mcp_json is required (JSON string with name, command, etc.)"}
            result = subprocess.run(
                [AGY_CLI, "--add-mcp", mcp_json],
                capture_output=True, text=True, timeout=30,
            )
            return {
                "action": "add_mcp",
                "mcp_json": mcp_json[:200],
                "stdout": result.stdout[:2000],
                "stderr": result.stderr[:1000],
                "exit_code": result.returncode,
                "success": result.returncode == 0,
            }

        elif action == "run_terminal":
            # Open folder in Antigravity then send command via integrated terminal
            command = args.get("command", "")
            cwd = args.get("cwd", "")
            if not command:
                return {"error": "command is required"}

            import time as _time

            # Open the folder first if specified
            if cwd:
                subprocess.run([AGY_CLI, cwd], capture_output=True, text=True, timeout=15)
                _time.sleep(2)

            # Activate Antigravity
            tool_sys_open_app({"app_name": "Antigravity"})
            _time.sleep(1)

            # Open integrated terminal: Ctrl+`
            tool_sys_key({"key": "`", "modifiers": ["control"]})
            _time.sleep(0.5)

            # Type and execute command
            tool_sys_type({"text": command})
            _time.sleep(0.3)
            tool_sys_key({"key": "return"})

            return {
                "action": "run_terminal",
                "command": command,
                "cwd": cwd,
                "message": f"Executed '{command[:80]}' in Antigravity terminal",
            }

        elif action == "ai_edit":
            # Type prompt into Antigravity AI chat panel → it handles everything autonomously
            path = args.get("path", "")
            instruction = args.get("instruction", "")
            if not instruction:
                return {"error": "instruction is required"}

            import time as _time

            # Open the file/folder first if specified
            if path:
                if os.path.isdir(path):
                    subprocess.run([AGY_CLI, path], capture_output=True, text=True, timeout=15)
                else:
                    subprocess.run([AGY_CLI, "-g", path], capture_output=True, text=True, timeout=15)
                _time.sleep(2)
            else:
                # Just activate Antigravity
                tool_sys_open_app({"app_name": "Antigravity"})
                _time.sleep(1.5)

            # Open AI Chat panel: Cmd+Shift+I (Copilot Chat in VS Code-based editors)
            tool_sys_key({"key": "i", "modifiers": ["command", "shift"]})
            _time.sleep(1.5)

            # Build the prompt — if path specified, include context
            prompt = instruction
            if path and not os.path.isdir(path):
                prompt = f"File: {path}\n{instruction}"

            # Type the prompt into chat via clipboard paste (pre-composed text, not Telex)
            tool_sys_type({"text": prompt})
            _time.sleep(0.5)

            # Submit: press Enter
            tool_sys_key({"key": "return"})

            return {
                "action": "ai_edit",
                "path": path or "(current workspace)",
                "instruction": instruction[:100],
                "message": f"Sent to Antigravity AI Chat: '{instruction[:60]}...' — Antigravity is now working on it.",
            }

        elif action == "ai_inline":
            # Inline edit: select code → Cmd+I → type instruction (for quick edits)
            path = args.get("path", "")
            instruction = args.get("instruction", "")
            if not path or not instruction:
                return {"error": "path and instruction are required"}

            import time as _time

            subprocess.run([AGY_CLI, "-g", path], capture_output=True, text=True, timeout=15)
            _time.sleep(2)

            # Select all content: Cmd+A
            tool_sys_key({"key": "a", "modifiers": ["command"]})
            _time.sleep(0.3)

            # Trigger inline edit: Cmd+I
            tool_sys_key({"key": "i", "modifiers": ["command"]})
            _time.sleep(1)

            tool_sys_type({"text": instruction})
            _time.sleep(0.5)

            tool_sys_key({"key": "return"})

            return {
                "action": "ai_inline",
                "path": path,
                "instruction": instruction[:100],
                "message": f"Triggered inline AI edit on {path}: '{instruction[:60]}...'",
            }

        else:
            return {"error": f"Unknown action: {action}. Valid: open_file|open_folder|new_file|diff|goto|list_extensions|install_extension|uninstall_extension|add_mcp|run_terminal|ai_edit"}

    except subprocess.TimeoutExpired:
        return {"error": f"Antigravity command timed out for action: {action}"}
    except FileNotFoundError:
        return {"error": f"Antigravity CLI not found at {AGY_CLI}. Is Antigravity installed?"}
    except Exception as e:
        return {"error": f"Antigravity error: {str(e)}"}


def tool_project_tree(args: Dict[str, Any]) -> Dict[str, Any]:
    """Show project directory tree structure."""
    path = args.get("path") or "."
    
    if path == ".":
        path = os.getcwd()
        
    max_depth = int(args.get("depth") or 3)

    if not _check_path(path):
        return {"error": f"Path not allowed: {path}"}

    logger.info(f"🌳 Project tree: {path} (depth={max_depth})")
    try:
        # Better find command to get clean list
        cmd = f"find {path} -maxdepth {max_depth} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/__pycache__/*' -not -path '*/.venv/*' -not -path '*/dist/*' -not -name '.DS_Store' -not -name '*.pyc' | sort"
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)

        lines = result.stdout.strip().split('\n')
        if not lines or not lines[0]:
            return {"tree": "Empty directory.", "path": path}

        base = path.rstrip('/')
        tree_lines = []
        
        # File type icons mapping
        ext_icons = {
            ".py": "🐍", ".js": "🟨", ".jsx": "⚛️", ".ts": "🟦", ".tsx": "⚛️",
            ".css": "🎨", ".html": "🌐", ".json": "📦", ".md": "📝", ".env": "🔑",
            ".yml": "⚙️", ".yaml": "⚙️", ".sh": "🐚", ".git": "🌿"
        }

        # Simplified tree builder that uses proper prefixing
        path_list = [l for l in lines if l.strip()]
        for i, line in enumerate(path_list):
            rel = line.replace(base, '').lstrip('/')
            if not rel:
                tree_lines.append(f"📂 {os.path.basename(base)}/")
                continue
            
            parts = rel.split('/')
            depth = len(parts) - 1
            name = parts[-1]
            
            is_dir = os.path.isdir(line)
            
            # Determine icon
            if is_dir:
                icon = "📁"
            else:
                _, ext = os.path.splitext(name)
                icon = ext_icons.get(ext.lower(), "📄")

            # Determine prefix parts
            # This is a simplified approach for the "Agent" view. 
            # For a really perfect tree with vertical lines we'd need more state, 
            # but using standard box characters is already 10x better.
            prefix = "│   " * depth
            if i + 1 < len(path_list):
                # If next line is deeper or sibling, use tee
                next_rel = path_list[i+1].replace(base, '').lstrip('/')
                next_depth = len(next_rel.split('/')) - 1
                if next_depth >= depth:
                    connector = "├── "
                else:
                    connector = "└── "
            else:
                connector = "└── "
                
            tree_lines.append(f"{prefix}{connector}{icon} {name}{'/' if is_dir else ''}")

        return {"tree": "\n".join(tree_lines), "path": path, "total_items": len(lines)}
    except Exception as e:
        return {"error": str(e)}


def tool_git_ops(args: Dict[str, Any]) -> Dict[str, Any]:
    """Perform git operations."""
    action = args.get("action") or ""
    cwd = args.get("cwd") or os.path.expanduser("~/Public/hatai-remote")

    if not action:
        return {"error": "action required: status|diff|log|commit|push|pull|branch|stash|checkout"}

    logger.info(f"🔀 Git: {action} in {cwd}")
    try:
        if action == "status":
            r = subprocess.run(["git", "status", "--short"], capture_output=True, text=True, cwd=cwd, timeout=15)
            b = subprocess.run(["git", "branch", "--show-current"], capture_output=True, text=True, cwd=cwd, timeout=5)
            return {"branch": b.stdout.strip(), "status": r.stdout.strip(), "clean": not r.stdout.strip()}

        elif action == "diff":
            fp = args.get("file") or ""
            cmd = ["git", "diff"]
            if args.get("staged"):
                cmd.append("--staged")
            if fp:
                cmd.append(fp)
            r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, timeout=15)
            return {"diff": r.stdout[:8000]}

        elif action == "log":
            n = int(args.get("n") or 10)
            r = subprocess.run(["git", "log", f"-{n}", "--oneline", "--graph"], capture_output=True, text=True, cwd=cwd, timeout=15)
            return {"log": r.stdout.strip()}

        elif action == "commit":
            msg = args.get("message") or "auto-commit"
            subprocess.run(["git", "add", "."], capture_output=True, cwd=cwd, timeout=15)
            r = subprocess.run(["git", "commit", "-m", msg], capture_output=True, text=True, cwd=cwd, timeout=15)
            return {"stdout": r.stdout.strip(), "stderr": r.stderr.strip(), "exit_code": r.returncode}

        elif action == "push":
            branch = args.get("branch") or ""
            cmd = ["git", "push"]
            if branch:
                cmd.extend(["origin", branch])
            r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, timeout=30)
            return {"stdout": r.stdout.strip(), "stderr": r.stderr.strip(), "exit_code": r.returncode}

        elif action == "pull":
            r = subprocess.run(["git", "pull"], capture_output=True, text=True, cwd=cwd, timeout=30)
            return {"stdout": r.stdout.strip(), "stderr": r.stderr.strip(), "exit_code": r.returncode}

        elif action == "branch":
            name = args.get("name") or ""
            if name:
                r = subprocess.run(["git", "checkout", "-b", name], capture_output=True, text=True, cwd=cwd, timeout=15)
            else:
                r = subprocess.run(["git", "branch", "-a"], capture_output=True, text=True, cwd=cwd, timeout=15)
            return {"stdout": r.stdout.strip(), "exit_code": r.returncode}

        elif action == "stash":
            sub = args.get("sub") or "push"
            r = subprocess.run(["git", "stash", sub], capture_output=True, text=True, cwd=cwd, timeout=15)
            return {"stdout": r.stdout.strip(), "exit_code": r.returncode}

        elif action == "checkout":
            target = args.get("target") or ""
            if not target:
                return {"error": "target is required"}
            r = subprocess.run(["git", "checkout", target], capture_output=True, text=True, cwd=cwd, timeout=15)
            return {"stdout": r.stdout.strip(), "stderr": r.stderr.strip(), "exit_code": r.returncode}

        else:
            return {"error": f"Unknown git action: {action}"}
    except Exception as e:
        return {"error": str(e)}


def tool_multi_edit_file(args: Dict[str, Any]) -> Dict[str, Any]:
    """Apply multiple non-contiguous edits to a single file in one operation.
    edits: list of {old_text, new_text} pairs, applied in order.
    """
    path = args.get("path") or ""
    edits = args.get("edits") or []

    if not path:
        return {"error": "path is required"}
    if not edits or not isinstance(edits, list):
        return {"error": "edits must be a list of {old_text, new_text} pairs"}
        
    path = _resolve_relative_path(path)
    
    if not _check_path(path):
        return {"error": f"Path not allowed: {path}"}
    if not os.path.isfile(path):
        return {"error": f"File not found: {path} (Current Working Directory: {os.getcwd()})"}

    logger.info(f"✏️ Multi-edit: {path} ({len(edits)} edits)")
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        applied = 0
        errors = []
        for i, edit in enumerate(edits):
            old = edit.get("old_text", "")
            new = edit.get("new_text", "")
            if old not in content:
                errors.append(f"Edit {i+1}: old_text not found")
                continue
            content = content.replace(old, new, 1)
            applied += 1

        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

        result = {"path": path, "applied": applied, "total": len(edits)}
        if errors:
            result["errors"] = errors
        return result
    except Exception as e:
        return {"error": str(e)}


def tool_delete_all_tasks(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete all background tasks for the current user."""
    from db.psql.session import SessionLocal
    from db.psql.models.user import User
    from db.psql.models.task import AITask
    from core.task_runner import TaskRunner
    
    db = SessionLocal()
    try:
        user = db.query(User).first()
        user_id = user.id if user else 1
        
        # 1. Clear from memory
        TaskRunner.get().clear_all_tasks(user_id)
        
        # 2. Delete from DB
        db.query(AITask).filter(AITask.user_id == user_id).delete()
        db.commit()
        
        return {"message": "Successfully deleted all tasks."}
    except Exception as e:
        return {"error": f"Failed to delete tasks: {str(e)}"}
    finally:
        db.close()


# ── Tool Registry ──────────────────────────────────────────────────────────

TOOLS = {
    "run_command": tool_run_command,
    "read_file": tool_read_file,
    "analyze_document": tool_analyze_document,
    "write_file": tool_write_file,
    "list_dir": tool_list_dir,
    "screenshot": tool_screenshot,
    "update_docs": tool_update_docs,
    "web_search": tool_web_search,
    "read_web": tool_read_web,
    "deep_search": tool_deep_search,
    "edit_file": tool_edit_file,
    "replace_lines": tool_replace_lines,
    "search_code": tool_search_code,
    "find_files": tool_find_files,
    "browser_go": tool_browser_go,
    "site_search": tool_site_search,
    "open_browser": tool_open_browser,
    "browser_js": tool_browser_js,
    "browser_read": tool_browser_read,
    "browser_click": tool_browser_click,
    "browser_type": tool_browser_type,
    "sys_key": tool_sys_key,
    "sys_mouse": tool_sys_mouse,
    "sys_type": tool_sys_type,
    "sys_open_app": tool_sys_open_app,
    "sys_get_active_app": tool_sys_get_active_app,
    "sys_stats": tool_sys_stats,
    "add_knowledge": tool_add_knowledge,
    "query_knowledge": tool_query_knowledge,
    "clear_knowledge": tool_clear_knowledge,
    "get_current_time": tool_get_current_time,
    "excel_python": tool_excel_python,
    "remember": tool_remember,
    "browser_wait": tool_browser_wait,
    "browser_extract": tool_browser_extract,
    "browser_extract_prices": tool_browser_extract_prices,
    "browser_close_tab": tool_browser_close_tab,
    "fb_message": tool_fb_message,
    "scratchpad": tool_scratchpad,
    "claude_code": tool_claude_code,
    "antigravity": tool_antigravity,
    "create_background_task": tool_create_background_task,
    "delete_all_tasks": tool_delete_all_tasks,
    "project_tree": tool_project_tree,
    "git_ops": tool_git_ops,
    "multi_edit_file": tool_multi_edit_file,
    "session_query": tool_session_query,
    "clear_session_rag": tool_clear_session_rag,
    # Office tools (Excel, Word, PowerPoint)
    **OFFICE_TOOLS,
}


_TOOL_ALIASES = {
    "ai_edit": "antigravity",
    "ai_inline": "antigravity",
    "ai_coding": "antigravity",
    "ai_codding": "antigravity",
    "ai_codining": "antigravity",
    "ai_code": "antigravity",
    "code_edit": "antigravity",
    "google": "site_search",
    "google_search": "site_search",
    "web_search": "deep_search",
    "news_search": "deep_search",
    "search": "deep_search",
    "browse": "browser_go",
    "read_web": "browser_read",
    "get_page": "browser_read",
}


def execute_tool(tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a tool by name and return results."""
    # Normalize: strip whitespace, lowercase
    tool_name = tool_name.strip().lower()

    # Fuzzy alias matching for commonly hallucinated tool names
    if tool_name not in TOOLS:
        alias = _TOOL_ALIASES.get(tool_name)
        if alias:
            logger.info(f"🔀 Auto-corrected tool '{tool_name}' → '{alias}'")
            # For ai_edit/ai_inline aliases, inject the action if missing
            if tool_name in ("ai_edit", "ai_inline") and "action" not in args:
                args["action"] = tool_name.replace("ai_", "ai_")  # ai_edit → ai_edit
            tool_name = alias
        else:
            # Try case-insensitive match
            lower_tools = {k.lower(): k for k in TOOLS}
            if tool_name in lower_tools:
                tool_name = lower_tools[tool_name]
            else:
                return {"error": f"Unknown tool: {tool_name}. Available tools: {', '.join(sorted(TOOLS.keys()))}"}

    try:
        return TOOLS[tool_name](args)
    except Exception as e:
        return {"error": f"Tool execution error: {str(e)}"}
