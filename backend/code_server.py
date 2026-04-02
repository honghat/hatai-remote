"""
HatAI Code Server - Secondary server for Code & System Management
Runs on port 8001
"""
import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import ALLOWED_ORIGINS
from api.routes import auth, code
from db.psql.session import engine, Base

# Ensure data dir exists
os.makedirs("data", exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] code_server - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("data/code_server.log", encoding="utf-8")
    ]
)
logger = logging.getLogger("CodeServer")

app = FastAPI(
    title="HatAI Code Server",
    description="Dedicated server for source code management and system monitoring",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(code.router, prefix="/code", tags=["Code"])

@app.get("/health", tags=["System"])
def health():
    return {"status": "ok", "service": "HatAI Code Server"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
