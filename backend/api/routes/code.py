"""
Remote Code Control Routes
- POST /code/execute     - Execute shell command remotely
- GET  /code/history     - Command execution history
- POST /code/read        - Read a file
- POST /code/write       - Write to a file
- POST /code/list        - List a directory
- GET  /code/files       - List tracked code files
- POST /code/files       - Create/track a file
- PUT  /code/files/{id}  - Update a tracked file
- DELETE /code/files/{id} - Remove tracked file
"""
import os
import subprocess
import asyncio
import mimetypes
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

logger = logging.getLogger("CodeRouter")

from core.security import get_current_user
from db.psql.session import get_db
from db.psql.models.code import CodeFile, CommandLog, CodeHistory
from schemas.code import (
    CodeFileCreate,
    CodeFileUpdate,
    CodeFileOut,
    ExecuteCommand,
    CommandLogOut,
    ReadFileRequest,
    WriteFileRequest,
    ListDirRequest,
    CodeReviewRequest,
    CodeHistoryOut,
)

router = APIRouter()

# Allowed base paths for security (prevent arbitrary path traversal)
ALLOWED_BASE_PATHS = [
    "/Users/nguyenhat",
    "/Volumes/HatAI",
    "/tmp",
]


def _is_allowed_path(path: str) -> bool:
    """Check if path is under any allowed base."""
    abs_path = os.path.realpath(path)
    for base in ALLOWED_BASE_PATHS:
        if abs_path.startswith(os.path.realpath(base)):
            return True
    return False


@router.post("/execute", response_model=CommandLogOut, tags=["Code"])
async def execute_command(
    body: ExecuteCommand,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Execute a shell command on the server and return stdout/stderr."""
    cwd = body.cwd or os.path.expanduser("~")

    if not _is_allowed_path(cwd):
        raise HTTPException(status_code=403, detail=f"Đường dẫn không được phép: {cwd}")

    loop = asyncio.get_event_loop()

    def run():
        try:
            result = subprocess.run(
                body.command,
                shell=True,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=body.timeout,
            )
            return result.stdout, result.stderr, result.returncode
        except subprocess.TimeoutExpired:
            return "", "Command timed out", -1
        except Exception as e:
            return "", str(e), -1

    stdout, stderr, exit_code = await loop.run_in_executor(None, run)

    log = CommandLog(
        user_id=user_id,
        command=body.command,
        cwd=cwd,
        stdout=stdout[:10000],  # limit
        stderr=stderr[:5000],
        exit_code=exit_code,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/history", response_model=List[CommandLogOut], tags=["Code"])
def get_history(
    limit: int = 50,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(CommandLog)
        .filter(CommandLog.user_id == user_id)
        .order_by(CommandLog.created_at.desc())
        .limit(limit)
        .all()
    )


@router.post("/read", tags=["Code"])
def read_file(body: ReadFileRequest, user_id: int = Depends(get_current_user)):
    if not _is_allowed_path(body.path):
        raise HTTPException(status_code=403, detail="Đường dẫn không được phép")
    if not os.path.isfile(body.path):
        raise HTTPException(status_code=404, detail="File không tồn tại")
    try:
        with open(body.path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        return {"path": body.path, "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/write", tags=["Code"])
def write_file(body: WriteFileRequest, user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _is_allowed_path(body.path):
        raise HTTPException(status_code=403, detail="Đường dẫn không được phép")
    try:
        # Create backup if file exists
        if os.path.exists(body.path):
            try:
                with open(body.path, "r", encoding="utf-8", errors="replace") as f:
                    old_content = f.read()
                # Save to history
                hist = CodeHistory(
                    user_id=user_id,
                    path=body.path,
                    content=old_content,
                    change_summary=body.change_summary or "Manual update (remote editor)"
                )
                db.add(hist)
                db.commit()
            except Exception as backup_err:
                logger.warning(f"Failed to create backup for {body.path}: {backup_err}")

        os.makedirs(os.path.dirname(body.path), exist_ok=True)
        with open(body.path, "w", encoding="utf-8") as f:
            f.write(body.content)
        return {"message": "Đã ghi file thành công", "path": body.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history", tags=["Code"])
def get_file_history(path: str, limit: int = 10, user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    """Retrieve version history for a file."""
    return (
        db.query(CodeHistory)
        .filter(CodeHistory.user_id == user_id, CodeHistory.path == path)
        .order_by(CodeHistory.created_at.desc())
        .limit(limit)
        .all()
    )


@router.post("/revert", tags=["Code"])
def revert_file(history_id: int, user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    """Revert a file to a specific historical version."""
    hist = db.query(CodeHistory).filter(CodeHistory.id == history_id, CodeHistory.user_id == user_id).first()
    if not hist:
        raise HTTPException(status_code=404, detail="Phiên bản lịch sử không tồn tại")
    
    try:
        # Before reverting, save current as another backup
        if os.path.exists(hist.path):
             with open(hist.path, "r", encoding="utf-8", errors="replace") as f:
                curr_content = f.read()
             new_hist = CodeHistory(user_id=user_id, path=hist.path, content=curr_content, change_summary=f"Backup before revert to ID={history_id}")
             db.add(new_hist)

        with open(hist.path, "w", encoding="utf-8") as f:
            f.write(hist.content)
        
        db.commit()
        return {"message": "Đã khôi phục phiên bản thành công", "path": hist.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ai-edit", tags=["Code"])
async def ai_edit_code(body: CodeReviewRequest, user_id: int = Depends(get_current_user)):
    """AI modifies the code based on an instruction (prompt)."""
    from core.llm_engine import LLMEngine
    engine = LLMEngine.get()
    
    # instructions from field or from 'content' as fallback
    instruction = body.instruction or body.content or "Optimize and clean up this code."
    
    # If current_code provided use it, else read from disk
    current_code = body.current_code
    if not current_code:
        if not os.path.isfile(body.path):
            raise HTTPException(status_code=404, detail="File không tồn tại")
        with open(body.path, "r", encoding="utf-8", errors="replace") as f:
            current_code = f.read()

    sys_prompt = (
        "You are an expert full-stack developer. Your goal is to modify the provided code according to the user's instructions.\n"
        "Return ONLY the modified code without any explanations, markdown markers (like ```), or comments outside the code.\n"
        "Preserve the original context, indentation, and structure as much as possible."
    )
    
    user_prompt = (
        f"FILE PATH: {body.path}\n"
        f"USER INSTRUCTIONS: {instruction}\n\n"
        f"CURRENT CODE:\n{current_code}\n"
    )
    
    try:
        resp = await asyncio.to_thread(engine.chat, messages=[
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt}
        ])
        
        # Clean up output
        clean_code = resp.strip()
        if clean_code.startswith("```"):
            lines = clean_code.split("\n")
            if lines[0].startswith("```"): lines = lines[1:]
            if lines[-1].startswith("```"): lines = lines[:-1]
            clean_code = "\n".join(lines).strip()
            
        return {"modified_code": clean_code}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@router.post("/ai-review", tags=["Code"])
async def ai_review_code(body: CodeReviewRequest, user_id: int = Depends(get_current_user)):
    """AI perform deep review of the code."""
    from core.llm_engine import LLMEngine
    engine = LLMEngine.get()
    
    # content from body.current_code or body.content or read from disk
    content = body.current_code or body.content
    if not content:
        if not os.path.isfile(body.path):
            raise HTTPException(status_code=404, detail="File không tồn tại")
        with open(body.path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

    prompt = (
        f"You are a Senior Software Architect and Clean Code Expert.\n"
        f"Perform a deep review of the following code for: \n"
        f"1. Potential bugs or edge cases\n"
        f"2. Security vulnerabilities\n"
        f"3. Performance optimizations\n"
        f"4. Readability and Maintainability\n\n"
        f"FILE: {body.path}\n"
        f"CODE:\n```\n{content}\n```\n\n"
        f"Provide short, actionable feedback in Vietnamese."
    )
    
    try:
        resp = await asyncio.to_thread(engine.chat, messages=[{"role": "user", "content": prompt}])
        return {"review": resp}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/list", tags=["Code"])
def list_directory(body: ListDirRequest, user_id: int = Depends(get_current_user)):
    if not _is_allowed_path(body.path):
        raise HTTPException(status_code=403, detail="Đường dẫn không được phép")
    if not os.path.isdir(body.path):
        raise HTTPException(status_code=404, detail="Thư mục không tồn tại")
    try:
        items = []
        for entry in sorted(os.scandir(body.path), key=lambda e: (not e.is_dir(), e.name)):
            if entry.name.startswith("."):
                continue
            stat = entry.stat()
            items.append({
                "name": entry.name,
                "path": entry.path,
                "is_dir": entry.is_dir(),
                "size": stat.st_size if entry.is_file() else None,
                "modified": stat.st_mtime,
            })
        return {"path": body.path, "items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/scan", tags=["Code"])
def scan_project_code(user_id: int = Depends(get_current_user)):
    """Recursively scan project codebase (frontend & backend) for management overview."""
    # From backend/api/routes/code.py:
    # 1. backend/api/routes
    # 2. backend/api
    # 3. backend
    # 4. project_root (e.g., hatai-remote)
    # Corrected: 3 levels up from the DIRECTORY of this file is hatai-remote
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    
    logger.info(f"🔍 System Scan: Project codebase root identified as {project_root}")
    
    ignore_dirs = {
        "node_modules", ".git", ".venv", "__pycache__", "dist", "build", 
        "artifacts", ".claude", ".vscode", "venv", "env"
    }
    ignore_exts = {".pyc", ".pyo", ".pyd", ".db", ".sqlite3", ".log", ".DS_Store", ".png", ".jpg", ".jpeg", ".ico", ".svg"}
    
    files = []
    
    if not os.path.isdir(project_root):
        logger.error(f"❌ Project root dir not found: {project_root}")
        return {"total": 0, "files": [], "error": f"Project root not found at {project_root}"}
    
    for root, dirs, filenames in os.walk(project_root):
        # Remove ignored directories in-place to stop recursion
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        
        for filename in filenames:
            ext = os.path.splitext(filename)[1].lower()
            # Only include code-relevant extensions
            included_exts = {".py", ".jsx", ".js", ".md", ".txt", ".sh", ".css", ".html", ".tsx", ".ts"}
            if ext not in included_exts:
                continue
                
            full_path = os.path.join(root, filename)
            rel_path = os.path.relpath(full_path, project_root)
            
            # Categorize
            category = "Other"
            if rel_path.startswith("backend"): category = "Backend"
            elif rel_path.startswith("frontend"): category = "Frontend"
            elif rel_path.startswith("chrome_extension"): category = "Extension"
            
            try:
                stat = os.stat(full_path)
                
                # Reading content for the management table if it's a code file
                content = None
                if stat.st_size < 100 * 1024:  # Max 100KB for safety
                    try:
                        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                            content = f.read(50000) # Read up to 50k chars for preview
                    except Exception:
                        content = "[Error reading content]"
                else:
                    content = "[File too large for fast preview]"

                files.append({
                    "name": filename,
                    "path": rel_path,
                    "full_path": full_path,
                    "category": category,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "extension": ext.replace(".", "") or "txt",
                    "content": content
                })
            except Exception:
                continue
                
    logger.info(f"✅ System Scan Complete: {len(files)} source files discovered in {project_root}")
    return {"total": len(files), "files": sorted(files, key=lambda x: x["path"])}


# ── Tracked Files ──────────────────────────────────────────────────────────────

@router.get("/files", response_model=List[CodeFileOut], tags=["Code"])
def list_files(user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(CodeFile).filter(CodeFile.user_id == user_id).order_by(CodeFile.is_pinned.desc(), CodeFile.updated_at.desc()).all()


@router.post("/files", response_model=CodeFileOut, tags=["Code"])
def create_file(
    data: CodeFileCreate,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    f = CodeFile(
        user_id=user_id,
        name=data.name,
        path=data.path,
        language=data.language,
        content=data.content,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


@router.put("/files/{file_id}", response_model=CodeFileOut, tags=["Code"])
def update_file(
    file_id: int,
    data: CodeFileUpdate,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    f = db.query(CodeFile).filter(CodeFile.id == file_id, CodeFile.user_id == user_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="File không tồn tại")
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(f, field, val)
    db.commit()
    db.refresh(f)
    return f


@router.delete("/files/{file_id}", tags=["Code"])
def delete_file(
    file_id: int,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    f = db.query(CodeFile).filter(CodeFile.id == file_id, CodeFile.user_id == user_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="File không tồn tại")
    db.delete(f)
    db.commit()
    return {"message": "Đã xóa"}
