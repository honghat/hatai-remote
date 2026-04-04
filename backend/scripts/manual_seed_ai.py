import os
import sys

# Add backend to path
backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(backend_dir)

from db.psql.session import SessionLocal
from db.psql.models.ai_provider import AIProvider

def manual_seed():
    db = SessionLocal()
    try:
        # Clear existing providers to avoid duplicates for this manual run
        db.query(AIProvider).delete()
        
        providers = [
            AIProvider(
                name="Google Gemini Studio",
                provider_type="gemini",
                model_name="gemini-2.0-flash-exp",
                api_key="AIzaSyBbsKZD0G5lQgyln-yIrd4JIeEAxr4XHLI",
                is_active=True
            ),
            AIProvider(
                name="Ollama Home Cluster",
                provider_type="ollama",
                model_name="qwen3.5:4b",
                api_base="http://100.69.50.64:11434",
                is_active=False
            ),
            AIProvider(
                name="Enterprise / OpenAI Compat",
                provider_type="openai",
                model_name="Qwen3.5-9B-Q4_K_M.gguf",
                api_base="http://100.69.50.64:8080/v1",
                api_key="sk-no-key",
                is_active=False
            ),
            AIProvider(
                name="DeepSeek Pro (Web)",
                provider_type="deepseek",
                model_name="deepseek-chat",
                api_key="sk-...", # Placeholder for user to fill
                is_active=False
            )
        ]
        
        db.add_all(providers)
        db.commit()
        print(f"✅ Manually seeded {len(providers)} providers into DB.")
    finally:
        db.close()

if __name__ == "__main__":
    manual_seed()
