from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from db.psql.session import Base

class AIProvider(Base):
    __tablename__ = "ai_providers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False) # e.g. "DeepSeek Pro", "Gemini 2.0", "Local LLama"
    provider_type = Column(String, nullable=False) # "gemini", "ollama", "openai", "local"
    model_name = Column(String, nullable=False) # "deepseek-chat", "gemini-2.0-flash", etc.
    api_base = Column(String, nullable=True) # OpenAI URL or Ollama URL
    api_key = Column(String, nullable=True) # Masked in UI, stored in plain text here (for internal use)
    is_active = Column(Boolean, default=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
