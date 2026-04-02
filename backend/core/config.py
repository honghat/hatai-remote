from dotenv import load_dotenv
import os
import secrets
from pathlib import Path

# Load .env from backend directory
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

DB_CONFIG = {
    "server": os.getenv("DB_SERVER", "localhost"),
    "database": os.getenv("DB_DATABASE", "hatai_remote"),
    "username": os.getenv("DB_USERNAME", ""),
    "password": os.getenv("DB_PASSWORD", ""),
    "port": int(os.getenv("DB_PORT", 5432)),
}

DATABASE = os.getenv("DATABASE", "postgresql")
SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_hex(32))
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 43200))

# Embedding Model — GGUF for RAG (llama-cpp-python, Metal GPU accelerated)
EMBEDDING_MODEL_PATH = os.getenv("EMBEDDING_MODEL_PATH", "/Volumes/HatAI/Savecode/AI/Model/nomic-embed-text-v1.5.Q4_K_M.gguf")

# LLM Model — Local (Qwen/llama-cpp)
MODEL_PATH = os.getenv("MODEL_PATH", "/Volumes/HatAI/Savecode/AI/Model/Qwen3-4B-Q4_K_M.gguf")
MODEL_N_GPU_LAYERS = int(os.getenv("MODEL_N_GPU_LAYERS", -1))
MODEL_N_CTX = int(os.getenv("MODEL_N_CTX", 16384))

# LLM Model — Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# LLM Model - Ollama
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3.5:4b")

# LLM Model - OpenAI Compatible API (llama-cpp server)
OPENAI_API_BASE = os.getenv("OPENAI_API_BASE", "http://100.69.50.64:8080/v1")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "sk-no-key")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "qwen3-4b")

# Active LLM provider: "local" (Qwen), "gemini", "ollama", or "openai"
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")

# CORS
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000"
).split(",")

# ── Data Paths ──────────────────────────────────────────────
BACKEND_DIR = Path(__file__).parent.parent
DATA_DIR = BACKEND_DIR / "data"
SOUL_PATH = DATA_DIR / "soul_memory.md"
SCRATCHPAD_PATH = DATA_DIR / "scratchpad.md"
PREFERENCES_PATH = DATA_DIR / "preferences.json"
EPISODES_DIR = DATA_DIR / "episodes"
SCREENSHOTS_DIR = DATA_DIR / "screenshots"

# Ensure directories exist
for _dir in [DATA_DIR, EPISODES_DIR, SCREENSHOTS_DIR]:
    _dir.mkdir(parents=True, exist_ok=True)

