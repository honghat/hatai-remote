import os
import logging
import threading
from typing import List, Dict, Any

try:
    import chromadb
    from chromadb.api.types import EmbeddingFunction, Documents, Embeddings
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    RAG_AVAILABLE = True
except ImportError:
    RAG_AVAILABLE = False
    # Fallback base class so the module can still be imported
    EmbeddingFunction = object
    Documents = List[str]
    Embeddings = List[List[float]]

logger = logging.getLogger("RAGEngine")


class LlamaCppEmbeddingFunction(EmbeddingFunction):
    """ChromaDB embedding function using llama-cpp-python (Metal GPU accelerated)."""

    def __init__(self, model_path: str):
        from llama_cpp import Llama
        import multiprocessing

        self._lock = threading.Lock()
        n_threads = max(1, multiprocessing.cpu_count() // 2)
        logger.info(f"⚡ Loading embedding model via llama-cpp: {model_path}")
        self._model = Llama(
            model_path=model_path,
            n_gpu_layers=-1,       # Full GPU offload (Metal)
            n_ctx=2048,            # Match model's training context
            n_batch=512,
            n_threads=n_threads,
            embedding=True,        # Enable embedding mode
            verbose=False,
        )
        # Workaround for llama-cpp-python >= 0.3.17 bug:
        # kv_cache_clear() asserts memory != None but embedding models don't init KV cache.
        if hasattr(self._model, '_ctx') and self._model._ctx is not None:
            if getattr(self._model._ctx, 'memory', None) is None:
                self._model._ctx.kv_cache_clear = lambda: None
                logger.info("⚙️ Applied kv_cache_clear workaround for embedding model")
        logger.info("✅ Embedding model loaded (llama-cpp, Metal GPU)")

    def __call__(self, input: Documents) -> Embeddings:
        """Generate embeddings for a list of documents with thread safety."""
        with self._lock:
            embeddings = []
            for text in input:
                try:
                    result = self._model.create_embedding(text)
                    vec = result["data"][0]["embedding"]
                    embeddings.append(vec)
                except Exception as e:
                    logger.error(f"Embedding error for text: {e}")
                    # Return zero vector fallback to avoid breaking ChromaDB
                    embeddings.append([0.0] * 768) # Nomic 768 dim
            return embeddings


class RAGEngine:
    _instance = None
    _lock = threading.Lock()
    _collection_lock = threading.Lock()

    @classmethod
    def get(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.enabled = RAG_AVAILABLE
        self._embedding_fn = None
        self._model_loading_lock = threading.Lock()

        if not self.enabled:
            logger.warning("RAG dependencies not installed. RAG engine disabled.")
            return

        self.db_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "chroma_db")
        os.makedirs(self.db_dir, exist_ok=True)

        try:
            # Initialize ChromaDB persistent client
            self.client = chromadb.PersistentClient(path=self.db_dir)
            logger.info("✅ RAG Knowledge Base initialized (ChromaDB)")
        except Exception as e:
            msg = str(e).lower()
            if "nothing found on disk" in msg or "hnsw" in msg or "segment reader" in msg:
                 logger.error(f"⚠️ RAG Database corrupted: {e}. Attempting automated repair...")
                 import shutil
                 try:
                     shutil.rmtree(self.db_dir)
                     os.makedirs(self.db_dir, exist_ok=True)
                     self.client = chromadb.PersistentClient(path=self.db_dir)
                     logger.info("♻️ RAG Database cleared and re-initialized successfully.")
                 except Exception as repair_err:
                     logger.error(f"❌ Failed to repair RAG Database: {repair_err}")
            else:
                logger.error(f"Failed to initialize RAG Engine: {e}")
                self.enabled = False

        # We will separate knowledge by topics into collections
        self.collections = {}

        # Text splitter to divide raw text into manageable chunks
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
        )

        # ── Auto-migrate: nuke old collections that stored HF model name ──
        self._migrate_old_collections()

    def _migrate_old_collections(self):
        """One-time migration: delete and recreate collections that have the old HF model name baked in."""
        migrate_flag = os.path.join(self.db_dir, ".migrated_to_llama_cpp_embeddings")
        if os.path.exists(migrate_flag):
            return

        try:
            collections = self.client.list_collections()
            if not collections:
                with open(migrate_flag, "w") as f:
                    f.write("done")
                return

            logger.info(f"🔄 Migrating {len(collections)} ChromaDB collections to llama-cpp embeddings...")

            ef = self.embedding_fn
            if ef is None:
                logger.warning("⚠️ Cannot migrate: embedding model not available")
                return

            for col in collections:
                col_name = getattr(col, 'name', str(col))
                try:
                    old_col = self.client.get_collection(name=col_name)
                    all_data = old_col.get(include=["documents", "metadatas"])

                    if not all_data["ids"]:
                        self.client.delete_collection(name=col_name)
                        self.client.get_or_create_collection(name=col_name, embedding_function=ef)
                        continue

                    # Pre-compute embeddings before delete to avoid HNSW init error
                    docs = all_data["documents"]
                    logger.info(f"  ⏳ Computing embeddings for '{col_name}' ({len(docs)} docs)...")
                    precomputed_embeddings = ef(docs)

                    self.client.delete_collection(name=col_name)
                    new_col = self.client.get_or_create_collection(name=col_name, embedding_function=ef)
                    new_col.add(
                        ids=all_data["ids"],
                        documents=docs,
                        metadatas=all_data["metadatas"],
                        embeddings=precomputed_embeddings,
                    )
                    logger.info(f"  ✅ Migrated '{col_name}': {len(all_data['ids'])} docs")
                except Exception as e:
                    logger.error(f"  ❌ Failed to migrate '{col_name}': {e}")

            with open(migrate_flag, "w") as f:
                f.write("done")
            logger.info("🎉 ChromaDB migration complete — all collections now use llama-cpp embeddings")

        except Exception as e:
            logger.error(f"Migration error: {e}")

    @property
    def embedding_fn(self):
        """Lazy load the embedding model using llama-cpp-python (Metal GPU)."""
        if not self.enabled:
            return None

        if self._embedding_fn is None:
            with self._model_loading_lock:
                if self._embedding_fn is None:
                    from core.config import EMBEDDING_MODEL_PATH

                    if not os.path.exists(EMBEDDING_MODEL_PATH):
                        logger.error(
                            f"❌ Embedding GGUF model not found at {EMBEDDING_MODEL_PATH}. "
                            "Download one, e.g.:\n"
                            "  huggingface-cli download nomic-ai/nomic-embed-text-v1.5-GGUF "
                            "nomic-embed-text-v1.5.Q4_K_M.gguf --local-dir /Volumes/HatAI/Savecode/AI/Model/"
                        )
                        return None

                    try:
                        self._embedding_fn = LlamaCppEmbeddingFunction(
                            model_path=EMBEDDING_MODEL_PATH
                        )
                    except Exception as e:
                        logger.error(f"Failed to load embedding model: {e}")
                        return None
        return self._embedding_fn

    def _get_collection(self, topic: str, user_id: int = 1):
        if not self.enabled:
            return None

        import unicodedata
        import re

        with self._collection_lock:
            # Topic name normalization
            n_text = unicodedata.normalize('NFKD', topic.strip().lower())
            ascii_text = n_text.encode('ascii', 'ignore').decode('ascii')
            clean_topic = re.sub(r'[^a-z0-9_]', '_', ascii_text)
            clean_topic = re.sub(r'_+', '_', clean_topic).strip('_')

            if not clean_topic:
                clean_topic = "general"

            # Prepend user ID to isolate collections
            col_name = f"u{user_id}_{clean_topic}"[:63] # Limit to 63 chars (chroma limit)

            if col_name not in self.collections:
                ef = self.embedding_fn
                try:
                    self.collections[col_name] = self.client.get_or_create_collection(
                        name=col_name,
                        embedding_function=ef
                    )
                except Exception as e:
                    logger.error(f"Failed to get/create collection '{col_name}': {e}")
                    return None
            return self.collections[col_name]

    def add_knowledge_batch(self, topic: str, documents: List[str], metadatas: List[Dict[str, Any]], user_id: int = 1) -> Dict[str, Any]:
        """Add multiple documents to a topic collection efficiently."""
        if not self.enabled:
            return {"error": "RAG engine is not installed/enabled"}

        collection = self._get_collection(topic, user_id=user_id)
        if not collection:
            return {"error": "Could not access knowledge collection"}

        all_chunks = []
        all_ids = []
        all_metas = []

        import uuid
        for i, doc in enumerate(documents):
            meta = metadatas[i] if i < len(metadatas) else {}
            chunks = self.text_splitter.split_text(doc)
            for chunk in chunks:
                all_chunks.append(chunk)
                all_ids.append(str(uuid.uuid4()))
                # Merge original meta with topic
                m = meta.copy()
                m["topic"] = topic
                all_metas.append(m)

        if not all_chunks:
            return {"message": "No content to index."}

        try:
            # Batch size for ChromaDB add (avoid too large single calls)
            batch_size = 100
            for i in range(0, len(all_chunks), batch_size):
                end = min(i + batch_size, len(all_chunks))
                collection.add(
                    ids=all_ids[i:end],
                    documents=all_chunks[i:end],
                    metadatas=all_metas[i:end]
                )
            return {"message": f"Successfully indexed {len(documents)} documents ({len(all_chunks)} chunks)."}
        except Exception as e:
            logger.error(f"Error in batch indexing: {e}")
            return {"error": str(e)}

    def add_knowledge(self, topic: str, content: str, source: str = "agent", user_id: int = 1) -> Dict[str, Any]:
        """Split content into chunks and add to the topic collection."""
        if not self.enabled:
            return {"error": "RAG engine is not installed/enabled"}

        if not content.strip():
            return {"error": "Content is empty"}

        collection = self._get_collection(topic, user_id=user_id)
        if not collection:
            return {"error": "Could not access knowledge collection"}

        chunks = self.text_splitter.split_text(content)

        if not chunks:
            return {"error": "Could not create chunks"}

        import uuid
        ids = [str(uuid.uuid4()) for _ in chunks]
        metadatas = [{"source": source, "topic": topic} for _ in chunks]

        try:
            collection.add(
                ids=ids,
                documents=chunks,
                metadatas=metadatas
            )
            return {"message": f"Successfully added {len(chunks)} chunks of knowledge to topic '{topic}'."}
        except Exception as e:
            logger.error(f"Error adding knowledge: {e}")
            return {"error": str(e)}

    def query_knowledge(self, topic: str, query: str, n_results: int = 3, max_distance: float = 1.5, user_id: int = 1) -> Dict[str, Any]:
        """Query the most relevant content from the topic collection.

        Args:
            max_distance: Maximum cosine distance threshold. Lower = more relevant.
                         Typical good matches: <0.8, acceptable: <1.2, weak: <1.5
        """
        if not self.enabled:
            return {"error": "RAG engine is not installed/enabled"}

        collection = self._get_collection(topic, user_id=user_id)
        if not collection:
            return {"error": "Could not access knowledge collection"}

        try:
            # Request more results than needed so we can filter by distance
            fetch_n = min(n_results * 2, 10)
            results = collection.query(
                query_texts=[query],
                n_results=fetch_n,
                include=["documents", "metadatas", "distances"],
            )

            if not results['documents'] or not results['documents'][0]:
                return {"message": f"No relevant information found for topic '{topic}'"}

            snippets = results['documents'][0]
            sources = results['metadatas'][0]
            distances = results['distances'][0] if results.get('distances') else [0.0] * len(snippets)

            formatted_results = []
            result_distances = []
            for i, snip in enumerate(snippets):
                dist = distances[i] if i < len(distances) else 999.0
                # Filter out irrelevant results by distance threshold
                if dist > max_distance:
                    continue
                src = sources[i].get("source", "unknown") if i < len(sources) else "unknown"
                formatted_results.append(f"[Source: {src}]\n{snip}")
                result_distances.append(dist)
                if len(formatted_results) >= n_results:
                    break

            if not formatted_results:
                return {"message": f"No relevant information found for topic '{topic}'"}

            return {
                "results": formatted_results,
                "distances": result_distances,
                "message": f"Found {len(formatted_results)} relevant references."
            }
        except Exception as e:
            msg = str(e).lower()
            if "nothing found on disk" in msg or "hnsw" in msg or "segment reader" in msg:
                logger.error(f"⚠️ Runtime RAG corruption: {e}. Deleting corrupted collection for topic '{topic}'.")
                try:
                    import unicodedata, re as _re
                    n_text = unicodedata.normalize('NFKD', topic.strip().lower())
                    ascii_text = n_text.encode('ascii', 'ignore').decode('ascii')
                    cname = _re.sub(r'_+', '_', _re.sub(r'[^a-z0-9_]', '_', ascii_text)).strip('_')[:60] or "general_knowledge"
                    self.client.delete_collection(name=cname)
                    self.collections.pop(cname, None)
                    logger.info(f"♻️ Deleted corrupted collection '{cname}'. It will be recreated on next add.")
                except Exception as del_err:
                    logger.error(f"Failed to delete corrupted collection: {del_err}")
                    self.collections = {}
                return {"error": "RAG index corrupted for this topic. Collection has been reset."}
            logger.error(f"Error querying knowledge: {e}")
            return {"error": str(e)}

    def list_topics(self, user_id: int = 1) -> List[str]:
        """Return list of existing topic collections for a specific user."""
        if not self.enabled:
            return []
        try:
            cols = self.client.list_collections()
            prefix = f"u{user_id}_"
            return [c.name.replace(prefix, "") for c in cols if c.name.startswith(prefix)]
        except Exception:
            return []

    def delete_topic(self, topic: str, user_id: int = 1) -> Dict[str, Any]:
        """Delete an entire topic collection for a specific user."""
        if not self.enabled:
            return {"error": "RAG engine is not installed/enabled"}

        # Use same normalization as _get_collection
        import unicodedata, re as _re
        n_text = unicodedata.normalize('NFKD', topic.strip().lower())
        ascii_text = n_text.encode('ascii', 'ignore').decode('ascii')
        clean_topic = _re.sub(r'[^a-z0-9_]', '_', ascii_text)
        clean_topic = _re.sub(r'_+', '_', clean_topic).strip('_')
        if not clean_topic: clean_topic = "general"
        
        col_name = f"u{user_id}_{clean_topic}"[:63]

        try:
            self.client.delete_collection(name=clean_topic)
            if clean_topic in self.collections:
                del self.collections[clean_topic]
            return {"message": f"Successfully deleted topic '{topic}' and all its associated data."}
        except Exception as e:
            logger.error(f"Error deleting topic: {e}")
            if "not found" in str(e).lower() or "does not exist" in str(e).lower():
                return {"message": f"Topic '{topic}' was not found or already deleted."}
            return {"error": str(e)}

    def clear_all_knowledge(self) -> Dict[str, Any]:
        """Delete all collections in the RAG database."""
        if not self.enabled:
            return {"error": "RAG engine is not installed/enabled"}

        try:
            topics = self.list_topics()
            for topic in topics:
                self.client.delete_collection(name=topic)
            self.collections = {}
            return {"message": f"Successfully cleared all {len(topics)} knowledge topics. The brain is now fresh!"}
        except Exception as e:
            logger.error(f"Error clearing knowledge: {e}")
            return {"error": str(e)}
