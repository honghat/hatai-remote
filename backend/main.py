"""
HatAI Remote - FastAPI Backend
Remote AI Control & Chat System powered by llama-cpp-python
"""
import asyncio
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import ALLOWED_ORIGINS
from core.llm_engine import LLMEngine

from api.routes import auth, ai, code, agent, memory, tasks, skills, schedules, ssh

# DB initialization
from db.psql.session import engine, Base
from db.psql.models import user, chat, code as code_models, task, scheduled_task, ssh_connection  # noqa: F401

import os
# Ensure data dir exists
os.makedirs("data", exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("data/system.log", encoding="utf-8")
    ]
)
logger = logging.getLogger("HatAI-Remote")


def create_tables():
    """Create all tables if they don't exist."""
    Base.metadata.create_all(bind=engine)
    logger.info("✅ Database tables created/verified.")


def load_model_background():
    """Load LLM model in a background thread."""
    engine_instance = LLMEngine.get()
    engine_instance.load()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    create_tables()
    logger.info("🚀 Starting HatAI Remote server...")
    thread = threading.Thread(target=load_model_background, daemon=True)
    thread.start()
    logger.info("⏳ LLM model loading in background thread...")

    # Start Agent Daemon — always-on persistent agent
    from core.agent_daemon import AgentDaemon
    loop = asyncio.get_event_loop()
    daemon = AgentDaemon.get()
    daemon.start(event_loop=loop)
    logger.info("🤖 Agent Daemon started — listening for commands")

    # Start Schedule Runner — cron-based periodic tasks
    from core.schedule_runner import ScheduleRunner
    scheduler = ScheduleRunner.get()
    scheduler.start()
    logger.info("⏰ Schedule Runner started — polling for periodic tasks")

    yield
    # Shutdown
    scheduler.stop()
    daemon.stop()
    logger.info("🛑 Shutting down HatAI Remote.")


app = FastAPI(
    title="HatAI Remote",
    description="Remote AI Control & Chat System — powered by llama-cpp-python + Qwen3",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static Files
from fastapi.staticfiles import StaticFiles
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Routes
app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(ai.router, prefix="/ai", tags=["AI"])
# Code moved to separate server (8001)
app.include_router(agent.router, prefix="/agent", tags=["Agent"])
app.include_router(tasks.router, prefix="/tasks", tags=["Tasks"])
app.include_router(memory.router, tags=["Memory"])
app.include_router(skills.router, tags=["Skills"])
app.include_router(schedules.router, prefix="/schedules", tags=["Schedules"])
app.include_router(ssh.router, prefix="/ssh", tags=["SSH"])

@app.get("/health", tags=["System"])
def health():
    llm = LLMEngine.get()
    return {
        "status": "ok",
        "service": "HatAI Remote",
        "version": "2.0.0",
        "provider": llm.provider,
        "model_ready": llm.is_ready,
    }
