import sys
import os
import asyncio
from pathlib import Path

# Add backend to path to import core modules
sys.path.append(os.path.abspath(os.path.join(os.getcwd(), 'backend')))

from core.memory import MemoryManager

def seed_knowledge():
    print("🧠 Khoi tao MemoryManager cho user 1...")
    memory = MemoryManager.get(owner_id=1)
    
    topic = "He thong HatAI"
    knowledge_items = [
        {
            "content": "HatAI la mot may tram AI (AI Workstation) chuyen nghiep danh cho lap trinh vien va quan ly cong viec. No tich hop Agent tu dong hoa, he thong tri thuc RAG va kha nang xu ly media toan dien.",
            "source": "system_init"
        },
        {
            "content": "Kien truc HatAI bao gom Backend (FastAPI, Python) va Frontend (Vite, React, Tailwind CSS). Agent su dung cac mo hinh LLM (Gemini, OpenAI, Ollama) thong qua LLMEngine de thuc hien cac tac vu logic phuc tap.",
            "source": "system_init"
        },
        {
            "content": "Cai dat Agent (Brain) la trung tam quan ly tri nho, bao gom: Soul (tinh cach/ban sac), Scratchpad (bo nho tam thoi), RAG Knowledge (tri thuc dai han linh hoat) va Episodes (lich su cac cuoc hoi thoai va bai hoc rut ra).",
            "source": "system_init"
        },
        {
            "content": "Agent co cac Cong cu (Skills) la cac tap tin Python cho phep tiep can he thong thuc te nhu: doc noi dung web, quan ly tep tin, phan tich du lieu va thuc hien cac lenh terminal an toan.",
            "source": "system_init"
        },
        {
            "content": "Tac vu dinh ky (Schedules) cho phep nguoi dung cau hinh Agent tu dong thuc hien cac nhiem vu theo lich Cron (vi du: tu dong tom tat tin tuc cong nghe moi sang luc 8h).",
            "source": "system_init"
        },
        {
            "content": "Bich Lac la ten dinh danh (Identity) cua Agent trong he thong HatAI. Day la mot tro ly AI thong minh, tan tam va co kha nang tu hoc hoi thong qua cac trai nghiem lam viec voi nguoi dung.",
            "source": "system_init"
        }
    ]
    
    print(f"📁 Dang them {len(knowledge_items)} kien thuc vao chu de '{topic}'...")
    
    for item in knowledge_items:
        res = memory.rag.add_knowledge(
            topic=topic,
            content=item["content"],
            source=item["source"],
            user_id=1
        )
        if "error" in res:
            print(f"❌ Loi khi them item: {res['error']}")
        else:
            print(f"✅ Da them: {item['content'][:50]}...")

    print("\n🎉 Hoan tat khoi tao tri thuc co ban cho Agent.")

if __name__ == "__main__":
    seed_knowledge()
