"""
LLM Engine - Multi-provider wrapper
Supports:
  - Local: llama-cpp-python (Qwen3, etc.)
  - Gemini: Google Gemini API (gemini-2.0-flash, etc.)
  - Ollama: Local Ollama instance
  - OpenAI: OpenAI-compatible API (llama-cpp server, vLLM, default set to user's HTTP URL)
  - DeepSeek: DeepSeek Official API

Singleton with runtime provider switching.
"""
import threading
import logging
import json
import time
import os
from typing import Generator, List, Dict, Optional, Any
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

import core.config as config

logger = logging.getLogger("LLMEngine")


class LLMEngine:
    _instance = None
    _lock = threading.Lock()

    # Local model state
    _llm = None
    _local_loaded = False
    _local_loading = False
    _local_error: Optional[str] = None

    # Gemini state
    _gemini_client = None
    _gemini_ready = False
    _gemini_error: Optional[str] = None

    # Ollama state
    _ollama_client = None
    _ollama_ready = False
    _ollama_error: Optional[str] = None

    # OpenAI-compatible state
    _openai_ready = False
    _openai_error: Optional[str] = None

    # DeepSeek state
    _deepseek_ready = False
    _deepseek_error: Optional[str] = None

    # Active provider
    _provider: str = config.LLM_PROVIDER  # "local", "gemini", "ollama", "openai", "deepseek"

    @classmethod
    def get(cls) -> "LLMEngine":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    # ── Provider switching ──────────────────────────────────────────────────

    @property
    def provider(self) -> str:
        return self._provider

    def reload_provider_config(self):
        """Reload configuration from memory and re-initialize active clients."""
        if config.GEMINI_API_KEY:
            self._gemini_ready = False  # force reinit
            self._init_gemini()
        if config.OLLAMA_URL:
            self._ollama_ready = False  # force reinit
            self._init_ollama()
        if config.OPENAI_API_BASE:
            self._openai_ready = False
            self._init_openai()
        if config.DEEPSEEK_API_KEY:
            self._deepseek_ready = False
            self._init_deepseek()

    def set_provider(self, provider: str) -> dict:
        """Switch active LLM provider at runtime."""
        if provider not in ("local", "gemini", "ollama", "openai", "deepseek"):
            return {"error": f"Unknown provider: {provider}. Use 'local', 'gemini', 'ollama', 'openai' or 'deepseek'"}

        old = self._provider
        self._provider = provider
        logger.info(f"🔄 LLM provider switched: {old} → {provider}")

        # Auto-initialize if needed
        if provider == "gemini" and not self._gemini_ready:
            self._init_gemini()
        elif provider == "ollama" and not self._ollama_ready:
            self._init_ollama()
        elif provider == "openai" and not self._openai_ready:
            self._init_openai()
        elif provider == "deepseek" and not self._deepseek_ready:
            self._init_deepseek()
        elif provider == "local" and not self._local_loaded:
            return {
                "message": f"Switched to {provider}",
                "warning": "Local model not loaded. Call /ai/load to load it.",
            }

        return {
            "message": f"Switched to {provider}",
            "ready": self.is_ready,
        }

    def load_from_db(self):
        """Load the active provider and its configuration from the database."""
        from db.psql.session import SessionLocal
        from db.psql.models.ai_provider import AIProvider
        db = SessionLocal()
        try:
            active = db.query(AIProvider).filter(AIProvider.is_active == True).first()
            if active:
                logger.info(f"📍 Applying Active Neural Source: {active.name} ({active.provider_type})")
                self._provider = active.provider_type
                
                # Dynamically update config for this runtime session
                if active.provider_type == "gemini":
                    config.GEMINI_API_KEY = active.api_key
                    config.GEMINI_MODEL = active.model_name
                    self._gemini_ready = False
                    self._init_gemini()
                elif active.provider_type == "ollama":
                    config.OLLAMA_URL = active.api_base
                    config.OLLAMA_MODEL = active.model_name
                    self._ollama_ready = False
                    self._init_ollama()
                elif active.provider_type == "openai":
                    config.OPENAI_API_BASE = active.api_base
                    config.OPENAI_API_KEY = active.api_key
                    config.OPENAI_MODEL = active.model_name
                    self._openai_ready = False
                    self._init_openai()
                elif active.provider_type == "deepseek":
                    config.DEEPSEEK_API_KEY = active.api_key
                    config.DEEPSEEK_MODEL = active.model_name
                    self._deepseek_ready = False
                    self._init_deepseek()
                
                return {"success": True, "provider": active.provider_type}
        except Exception as e:
            logger.error(f"❌ Failed to load provider from DB: {e}")
        finally:
            db.close()
        return {"success": False}

    # ── Loading ─────────────────────────────────────────────────────────────

    def load(self):
        """Load active provider from DB and LOCAL model into memory."""
        # 1. Try to load active provider and its config from Database
        self.load_from_db()

        # 2. Load Local Model if needed (llama-cpp)
        if self._local_loaded or self._local_loading:
            return
        self._local_loading = True
        self._local_error = None
        try:
            from llama_cpp import Llama
            import multiprocessing
            n_threads = max(1, multiprocessing.cpu_count() // 2)
            logger.info(f"⏳ Loading core local model: {config.MODEL_PATH}")
            self._llm = Llama(
                model_path=config.MODEL_PATH,
                n_gpu_layers=config.MODEL_N_GPU_LAYERS,
                n_ctx=config.MODEL_N_CTX,
                n_threads=n_threads,
                verbose=False,
            )
            self._local_loaded = True
            logger.info("✅ Local model ready.")
        except Exception as e:
            self._local_error = str(e)
            logger.error(f"❌ Core local model failed: {e}")
        finally:
            self._local_loading = False

        # Also init APIs if keys are available
        if config.GEMINI_API_KEY:
            self._init_gemini()
        if config.OLLAMA_URL:
            self._init_ollama()
        if config.OPENAI_API_BASE:
            self._init_openai()
        if config.DEEPSEEK_API_KEY:
            self._init_deepseek()

    def _init_gemini(self):
        """Initialize Gemini API client."""
        if self._gemini_ready:
            return
        if not config.GEMINI_API_KEY:
            self._gemini_error = "GEMINI_API_KEY not set in .env"
            logger.warning("⚠️ Gemini API key not configured")
            return
        try:
            from google import genai

            self._gemini_client = genai.Client(api_key=config.GEMINI_API_KEY)
            self._gemini_ready = True
            logger.info(f"✅ Gemini API ready (model: {config.GEMINI_MODEL})")
        except ImportError:
            self._gemini_error = "google-genai package not installed. Run: pip install google-genai"
            logger.error(f"❌ {self._gemini_error}")
        except Exception as e:
            self._gemini_error = str(e)
            logger.error(f"❌ Gemini init failed: {e}")

    def _init_ollama(self):
        """Initialize Ollama API client."""
        if self._ollama_ready:
            return
        if not config.OLLAMA_URL:
            self._ollama_error = "OLLAMA_URL not set in .env"
            logger.warning("⚠️ Ollama URL not configured")
            return
        self._ollama_ready = True  # We assume it's ready, actual calls will verify
        logger.info(f"✅ Ollama configuration loaded ({config.OLLAMA_URL})")

    def _init_openai(self):
        """Initialize OpenAI API compatible setup."""
        if self._openai_ready:
            return
        if not config.OPENAI_API_BASE:
            self._openai_error = "OPENAI_API_BASE not set in .env"
            logger.warning("⚠️ OpenAI API Base not configured")
            return
        self._openai_ready = True
        logger.info(f"✅ OpenAI API compatible configuration loaded ({config.OPENAI_API_BASE})")

    def _init_deepseek(self):
        """Initialize DeepSeek API compatible setup."""
        if self._deepseek_ready:
            return
        if not config.DEEPSEEK_API_KEY:
            self._deepseek_error = "DEEPSEEK_API_KEY not set in .env"
            logger.warning("⚠️ DeepSeek API key not configured")
            return
        self._deepseek_ready = True
        logger.info(f"✅ DeepSeek API configuration loaded")

    # ── Status ──────────────────────────────────────────────────────────────

    @property
    def is_ready(self) -> bool:
        if self._provider == "gemini":
            return self._gemini_ready
        elif self._provider == "ollama":
            return self._ollama_ready
        elif self._provider == "openai":
            return self._openai_ready
        elif self._provider == "deepseek":
            return self._deepseek_ready
        return self._local_loaded and self._llm is not None

    @property
    def status(self) -> dict:
        return {
            "provider": self._provider,
            "local": {
                "loaded": self._local_loaded,
                "loading": self._local_loading,
                "error": self._local_error,
                "model_path": config.MODEL_PATH,
                "n_gpu_layers": config.MODEL_N_GPU_LAYERS,
                "n_ctx": config.MODEL_N_CTX,
            },
            "gemini": {
                "ready": self._gemini_ready,
                "error": self._gemini_error,
                "model": config.GEMINI_MODEL,
                "api_key_set": bool(config.GEMINI_API_KEY),
            },
            "ollama": {
                "ready": self._ollama_ready,
                "error": self._ollama_error,
                "url": config.OLLAMA_URL,
                "model": config.OLLAMA_MODEL,
            },
            "openai": {
                "ready": self._openai_ready,
                "error": self._openai_error,
                "api_base": config.OPENAI_API_BASE,
                "model": config.OPENAI_MODEL,
            },
            "deepseek": {
                "ready": self._deepseek_ready,
                "error": self._deepseek_error,
                "model": config.DEEPSEEK_MODEL,
                "api_key_set": bool(config.DEEPSEEK_API_KEY),
            },
        }

    # ── Chat methods ────────────────────────────────────────────────────────

    # Tracks finish reason of last stream call: "stop" | "length" | "unknown"
    _last_finish_reason: str = "stop"
    # Set to True when LLM returns context overflow error (e.g. OpenAI 400)
    _context_overflow: bool = False
    # Mutex to protect llama.cpp from concurrent generation crashes
    _local_inference_lock = threading.Lock()

    def chat_stream(
        self,
        messages: List[Dict[str, str]],
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> Generator[str, None, None]:
        """Stream chat response token by token."""
        if not self.is_ready:
            yield f"[ERROR] {self._provider} model not ready. Check /ai/status"
            return

        self._last_finish_reason = "stop"  # reset before each call

        if self._provider == "gemini":
            yield from self._gemini_stream(messages, max_tokens, temperature)
        elif self._provider == "ollama":
            yield from self._ollama_stream(messages, max_tokens, temperature)
        elif self._provider == "openai":
            yield from self._openai_stream(messages, max_tokens, temperature)
        elif self._provider == "deepseek":
            yield from self._deepseek_stream(messages, max_tokens, temperature)
        else:
            yield from self._local_stream(messages, max_tokens, temperature)

    def chat_sync(
        self,
        messages: List[Dict[str, str]],
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> str:
        """Synchronous chat completion."""
        if not self.is_ready:
            return f"[ERROR] {self._provider} model not ready."

        if self._provider == "gemini":
            return self._gemini_sync(messages, max_tokens, temperature)
        elif self._provider == "ollama":
            return self._ollama_sync(messages, max_tokens, temperature)
        elif self._provider == "openai":
            return self._openai_sync(messages, max_tokens, temperature)
        elif self._provider == "deepseek":
            return self._deepseek_sync(messages, max_tokens, temperature)
        else:
            return self._local_sync(messages, max_tokens, temperature)

    # ── Local (llama-cpp) implementations ───────────────────────────────────

    def _clean_messages_for_local(self, messages):
        """llama.cpp chat handlers crash if content is a list (e.g. text + image_url). Sanitize it."""
        cleaned = []
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, list):
                # Extract text, drop images for local text-only model
                text_parts = [p.get("text", "") for p in content if p.get("type") == "text"]
                cleaned.append({"role": msg["role"], "content": "\n".join(text_parts)})
            else:
                cleaned.append({"role": msg["role"], "content": str(content)})
        return cleaned

    def _local_stream(self, messages, max_tokens, temperature):
        clean_msgs = self._clean_messages_for_local(messages)
        with self._local_inference_lock:
            response = self._llm.create_chat_completion(
                messages=clean_msgs,
                stream=True,
                max_tokens=max_tokens,
                temperature=temperature,
                repeat_penalty=1.15,
                top_p=0.9,
                presence_penalty=0.1,
            )
            for chunk in response:
                choice = chunk["choices"][0]
                fr = choice.get("finish_reason")
                if fr:
                    self._last_finish_reason = fr
                token = choice["delta"].get("content", "")
                if token:
                    yield token

    def _local_sync(self, messages, max_tokens, temperature):
        clean_msgs = self._clean_messages_for_local(messages)
        with self._local_inference_lock:
            response = self._llm.create_chat_completion(
                messages=clean_msgs,
                stream=False,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return response["choices"][0]["message"]["content"]

    # ── Gemini API implementations ──────────────────────────────────────────

    def _convert_messages_for_gemini(self, messages: List[Dict[str, str]]):
        """Convert OpenAI-style messages (including multimodal) to Gemini format."""
        system_instruction = None
        contents = []

        def _get_image_data(url):
            """Helper to get mime_type and base64 from a URL or local path."""
            import base64
            import mimetypes

            # 1. Handle Data URLs (Already Base64)
            if url.startswith("data:image/") and "," in url:
                header, b64data = url.split(",", 1)
                mime_type = header.split(";")[0].replace("data:", "")
                return mime_type, b64data

            # 2. Handle Local File Paths or Relative Media URLs
            path = None
            if os.path.exists(url):
                path = url
            elif url.startswith("/uploads/"):
                path = os.path.join("uploads", url.replace("/uploads/", ""))
            elif url.startswith("/api/uploads/"):
                path = os.path.join("uploads", url.replace("/api/uploads/", ""))
            elif url.startswith("/ai/media/"):
                path = os.path.join("media", url.replace("/ai/media/", ""))
            elif url.startswith("/api/ai/media/"):
                path = os.path.join("media", url.replace("/api/ai/media/", ""))

            if path and os.path.exists(path):
                try:
                    mime_type, _ = mimetypes.guess_type(path)
                    mime_type = mime_type or "image/png"
                    with open(path, "rb") as f:
                        b64data = base64.b64encode(f.read()).decode("utf-8")
                    return mime_type, b64data
                except Exception as e:
                    logger.error(f"❌ Failed to read image at {path}: {e}")

            return None, None

        def _content_to_parts(content):
            """Convert OpenAI content (str or list) to Gemini parts list."""
            if isinstance(content, str):
                return [{"text": content}]
            parts = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type", "")
                if btype == "text":
                    parts.append({"text": block.get("text", "")})
                elif btype == "image_url":
                    url = block.get("image_url", {}).get("url", "")
                    mime_type, b64data = _get_image_data(url)
                    if b64data:
                        parts.append({
                            "inline_data": {
                                "mime_type": mime_type,
                                "data": b64data,
                            }
                        })
            return parts or [{"text": ""}]

        for msg in messages:
            role = msg["role"]
            content = msg.get("content", "")

            if role == "system":
                if isinstance(content, str):
                    system_instruction = content
                elif isinstance(content, list):
                    system_instruction = " ".join(
                        p.get("text", "") for p in content
                        if isinstance(p, dict) and p.get("type") == "text"
                    )
            elif role in ("user", "assistant"):
                gemini_role = "user" if role == "user" else "model"
                parts = _content_to_parts(content)
                contents.append({"role": gemini_role, "parts": parts})

        return system_instruction, contents

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    def _gemini_stream(self, messages, max_tokens, temperature):
        from google.genai import types

        system_instruction, contents = self._convert_messages_for_gemini(messages)

        try:
            response = self._gemini_client.models.generate_content_stream(
                model=config.GEMINI_MODEL,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    max_output_tokens=max_tokens,
                    temperature=temperature,
                ),
            )
            for chunk in response:
                if chunk.text:
                    yield chunk.text
                # Track finish_reason from Gemini candidates
                if hasattr(chunk, 'candidates') and chunk.candidates:
                    candidate = chunk.candidates[0]
                    if hasattr(candidate, 'finish_reason') and candidate.finish_reason:
                        fr_name = str(candidate.finish_reason)
                        if 'MAX_TOKENS' in fr_name:
                            self._last_finish_reason = "length"
                        elif 'STOP' in fr_name:
                            self._last_finish_reason = "stop"
        except Exception as e:
            logger.error(f"❌ Gemini stream error: {e}")
            # Check if it's a 503 or 429
            if "503" in str(e) or "429" in str(e):
                logger.warning("🔄 Transient Gemini error, retrying...")
                raise e # Trigger tenacity retry
            yield f"[ERROR] Gemini API error: {str(e)}"

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    def _gemini_sync(self, messages, max_tokens, temperature):
        from google.genai import types

        system_instruction, contents = self._convert_messages_for_gemini(messages)

        try:
            response = self._gemini_client.models.generate_content(
                model=config.GEMINI_MODEL,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    max_output_tokens=max_tokens,
                    temperature=temperature,
                ),
            )
            return response.text or "[Empty response from Gemini]"
        except Exception as e:
            logger.error(f"❌ Gemini sync error: {e}")
            return f"[ERROR] Gemini API error: {str(e)}"

    # ── Ollama API implementations ──────────────────────────────────────────

    def _convert_messages_for_ollama(self, messages: List[Dict[str, Any]]):
        """Convert OpenAI-style multimodal messages to Ollama format."""
        import base64
        import os

        def _get_image_b64(url):
            if url.startswith("data:image/") and "," in url:
                return url.split(",", 1)[1]
            
            path = None
            if os.path.exists(url):
                path = url
            elif url.startswith("/uploads/"):
                path = os.path.join("uploads", url.replace("/uploads/", ""))
            elif url.startswith("/api/uploads/"):
                path = os.path.join("uploads", url.replace("/api/uploads/", ""))
            elif url.startswith("/ai/media/"):
                path = os.path.join("media", url.replace("/ai/media/", ""))
            elif url.startswith("/api/ai/media/"):
                path = os.path.join("media", url.replace("/api/ai/media/", ""))

            if path and os.path.exists(path):
                try:
                    with open(path, "rb") as f:
                        return base64.b64encode(f.read()).decode("utf-8")
                except:
                    pass
            return None

        ollama_msgs = []
        for msg in messages:
            content = msg.get("content")
            if isinstance(content, list):
                # Multimodal
                text_parts = []
                images = []
                for block in content:
                    if block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                    elif block.get("type") == "image_url":
                        url = block.get("image_url", {}).get("url", "")
                        b64 = _get_image_b64(url)
                        if b64:
                            images.append(b64)
                
                new_msg = {
                    "role": msg["role"],
                    "content": "\n".join(text_parts)
                }
                if images:
                    new_msg["images"] = images
                ollama_msgs.append(new_msg)
            else:
                ollama_msgs.append(msg)
        return ollama_msgs

    def _build_ollama_generate_payload(self, messages, max_tokens, temperature, stream=True):
        ollama_messages = self._convert_messages_for_ollama(messages)
        
        prompt = ""
        all_images = []
        
        for msg in ollama_messages:
            role = msg.get("role", "system").upper()
            content = msg.get("content", "")
            
            if role == "USER":
                prompt += f"USER: {content}\n\n"
            elif role == "ASSISTANT":
                prompt += f"ASSISTANT: {content}\n\n"
            elif role == "SYSTEM":
                prompt += f"SYSTEM: {content}\n\n"
                
            if "images" in msg:
                all_images.extend(msg["images"])
                
        # Append the trigger for the assistant to reply
        prompt += "ASSISTANT: "
        
        payload = {
            "model": config.OLLAMA_MODEL,
            "prompt": prompt,
            "stream": stream,
            "raw": True,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
                "num_ctx": max(8192, config.MODEL_N_CTX)
            }
        }
        
        if all_images:
            payload["images"] = all_images[-1:]
            
        return payload

    def _ollama_stream(self, messages, max_tokens, temperature):
        import requests
        
        payload = self._build_ollama_generate_payload(messages, max_tokens, temperature, stream=True)
        
        try:
            with requests.post(f"{config.OLLAMA_URL.rstrip('/')}/api/generate", json=payload, stream=True, timeout=(10, 300)) as resp:
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if line:
                        chunk = json.loads(line)
                        content = chunk.get("response", "")
                        if content:
                            yield content
                        if chunk.get("done"):
                            done_reason = chunk.get("done_reason", "stop")
                            self._last_finish_reason = "length" if done_reason == "length" else "stop"
        except Exception as e:
            logger.error(f"❌ Ollama stream error: {e}")
            yield f"[ERROR] Ollama API error: {str(e)}"

    def _ollama_sync(self, messages, max_tokens, temperature):
        import requests
        
        payload = self._build_ollama_generate_payload(messages, max_tokens, temperature, stream=False)
        
        try:
            resp = requests.post(f"{config.OLLAMA_URL.rstrip('/')}/api/generate", json=payload, timeout=(10, 300))
            resp.raise_for_status()
            data = resp.json()
            return data.get("response", "[Empty response from Ollama]")
        except Exception as e:
            logger.error(f"❌ Ollama sync error: {e}")
            return f"[ERROR] Ollama API error: {str(e)}"

    # ── OpenAI API implementations (llama-cpp-python server / vLLM) ─────────

    def _convert_messages_for_openai(self, messages: List[Dict[str, Any]]):
        """Convert multimodal messages to OpenAI format."""
        import base64
        import os
        import mimetypes

        def _get_image_data_uri(url):
            if url.startswith("data:image/") and "," in url:
                return url
            
            path = None
            if os.path.exists(url):
                path = url
            elif url.startswith("/uploads/"):
                path = os.path.join("uploads", url.replace("/uploads/", ""))
            elif url.startswith("/api/uploads/"):
                path = os.path.join("uploads", url.replace("/api/uploads/", ""))
            elif url.startswith("/ai/media/"):
                path = os.path.join("media", url.replace("/ai/media/", ""))
            elif url.startswith("/api/ai/media/"):
                path = os.path.join("media", url.replace("/api/ai/media/", ""))

            if path and os.path.exists(path):
                try:
                    mime_type, _ = mimetypes.guess_type(path)
                    mime_type = mime_type or "image/png"
                    with open(path, "rb") as f:
                        b64 = base64.b64encode(f.read()).decode("utf-8")
                    return f"data:{mime_type};base64,{b64}"
                except:
                    pass
            return None

        openai_msgs = []
        for msg in messages:
            content = msg.get("content")
            if isinstance(content, list):
                new_content = []
                for block in content:
                    if block.get("type") == "text":
                        new_content.append(block)
                    elif block.get("type") == "image_url":
                        url = block.get("image_url", {}).get("url", "")
                        data_uri = _get_image_data_uri(url)
                        if data_uri:
                            new_content.append({
                                "type": "image_url",
                                "image_url": {"url": data_uri}
                            })
                
                openai_msgs.append({
                    "role": msg["role"],
                    "content": new_content
                })
            else:
                openai_msgs.append(msg)
        return openai_msgs

    def _generic_openai_stream(self, messages, max_tokens, temperature, base_url, api_key, model_name):
        import requests

        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {api_key}"
        }

        openai_messages = self._convert_messages_for_openai(messages)

        payload = {
            "model": model_name,
            "messages": openai_messages,
            "stream": True,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        try:
            with requests.post(f"{base_url.rstrip('/')}/chat/completions", headers=headers, json=payload, stream=True, timeout=(10, 300)) as resp:
                if resp.status_code >= 400:
                    yield f"[ERROR] API {resp.status_code}: {resp.text}"
                    return
                
                for line in resp.iter_lines():
                    if line:
                        line = line.decode("utf-8")
                        if line.startswith("data:"):
                            data_str = line[5:].strip()
                            if data_str == "[DONE]":
                                break
                            
                            try:
                                chunk = json.loads(data_str)
                                choices = chunk.get("choices", [])
                                if not choices:
                                    continue
                                
                                choice = choices[0]
                                delta = choice.get("delta", {})
                                
                                content = delta.get("content", "")
                                if content:
                                    yield content
                                
                                reasoning = delta.get("reasoning_content", "")
                                if reasoning:
                                    yield f"<think>{reasoning}</think>"
                                    
                            except:
                                continue
        except Exception as e:
            logger.error(f"❌ OpenAI-compatible stream error: {e}")
            yield f"[ERROR] API error: {str(e)}"

    def _generic_openai_sync(self, messages, max_tokens, temperature, base_url, api_key, model_name):
        import requests

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }

        openai_messages = self._convert_messages_for_openai(messages)

        payload = {
            "model": model_name,
            "messages": openai_messages,
            "stream": False,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        try:
            resp = requests.post(f"{base_url.rstrip('/')}/chat/completions", headers=headers, json=payload, timeout=(10, 300))
            resp.raise_for_status()
            data = resp.json()
            choices = data.get("choices", [])
            if choices:
                msg_obj = choices[0].get("message", {})
                content = msg_obj.get("content")
                reasoning = msg_obj.get("reasoning_content")
                
                final_text = ""
                if reasoning:
                    final_text += f"<think>{reasoning}</think>\n\n"
                if content:
                    final_text += content
                    
                return final_text if final_text else "[Empty response]"
            return "[Empty response]"
        except Exception as e:
            logger.error(f"❌ OpenAI-compatible sync error: {e}")
            return f"[ERROR] API error: {str(e)}"

    def _openai_stream(self, messages, max_tokens, temperature):
        yield from self._generic_openai_stream(messages, max_tokens, temperature, config.OPENAI_API_BASE, config.OPENAI_API_KEY, config.OPENAI_MODEL)

    def _openai_sync(self, messages, max_tokens, temperature):
        return self._generic_openai_sync(messages, max_tokens, temperature, config.OPENAI_API_BASE, config.OPENAI_API_KEY, config.OPENAI_MODEL)

    def _deepseek_stream(self, messages, max_tokens, temperature):
        yield from self._generic_openai_stream(messages, max_tokens, temperature, "https://api.deepseek.com", config.DEEPSEEK_API_KEY, config.DEEPSEEK_MODEL)

    def _deepseek_sync(self, messages, max_tokens, temperature):
        return self._generic_openai_sync(messages, max_tokens, temperature, "https://api.deepseek.com", config.DEEPSEEK_API_KEY, config.DEEPSEEK_MODEL)
