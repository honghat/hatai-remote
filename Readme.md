# 🤖 HatAI - All In One

HatAI - All In One là một **trợ lý AI có ý thức và khả năng tự học liên tục**. Thay thế các workflow tĩnh bằng **Kiến trúc Bộ nhớ Thống nhất (Unified Memory Architecture)**, Agent không chỉ giao tiếp mà còn "ghi nhớ" mọi tương tác, rút kinh nghiệm từ lỗi sai và tự động xây dựng kho kiến thức (RAG) chuyên sâu của riêng mình. 
Tên trợ lý là Bích Lạc.
Dự án nhấn mạnh vào sự **Chính xác tuyệt đối** và **Tính kỷ luật** trong việc sử dụng công cụ, đảm bảo dữ liệu (như giá vàng, tài liệu tài chính) luôn là dữ liệu thực, không phỏng đoán.

---

## 🧭 Tầm nhìn & Sứ mệnh
Biến AI từ một công cụ xử lý lệnh đơn thuần thành một cộng sự số thực thụ, có khả năng:
- **Tự học (Self-Learning)**: Phân tích lịch sử công tác để cập nhật sở thích người dùng và bài học kinh nghiệm sau mỗi task.
- **Bộ nhớ vĩnh cửu (Persistent Memory)**: Duy trì trạng thái công việc và kiến thức qua nhiều phiên làm việc khác nhau nhờ ChromaDB.
- **Hành động tự chủ (Autonomous Agency)**: Tự lập kế hoạch và sử dụng các công cụ hệ thống (Python, Shell, Browser) để hoàn thành mục tiêu phức tạp.

---

## 🏗 Hệ thống Công nghệ (Tech Stack)

| Thành phần | Công nghệ sử dụng |
| :--- | :--- |
| **Frontend** | React 18, Vite, TailwindCSS (Theme: Premium Dark & Ultra-Clean) |
| **Backend** | FastAPI, Python 3.10+, SQLAlchemy (PostgreSQL 16) |
| **AI Engine** | llama-cpp-python (Local), Gemini API, Ollama (Multi-provider) |
| **Vector DB** | ChromaDB (RAG Knowledge Base & User Isolation) |
| **Local Model** | Qwen3-4B-Q4_K_M (Tối ưu cho Metal GPU/Mac) |

---

## 🛠 Kiến trúc Hệ thống v3

### 1. Unified Memory Manager (`memory.py`)
Hệ thống quản lý trạng thái tập trung cho Agent:
- **Soul (Linh hồn)**: Định hướng nhân cách, chỉ thị cốt lõi và quy tắc nghiêm ngặt về tool.
- **Preferences (Sở thích)**: Ghi nhớ thói quen người dùng (VD: phong cách code, định dạng báo cáo).
- **Episodes (Hồi ức)**: Lưu trữ các bản tóm tắt công việc đã thực hiện thành công.
- **Knowledge (Kiến thức)**: Hệ thống RAG đa luồng theo từng chủ đề (Topics) riêng biệt.
- **Topics**: Ghi nhớ các kiến thức theo lĩnh vực cơ bản của con người

### 2. Strict Tooling Protocol (Giao thức Kỷ luật Tool)
Khác với các AI thông thường, HatAI v3 bắt buộc tuân thủ:
- **Native over Bash**: Ưu tiên gọi hàm (Function Call) chuyên dụng (e.g., `deep_search`) thay vì dùng lệnh shell thô để đảm bảo độ tin cậy.
- **Double-Check Logic**: Luôn đối soát dữ liệu từ ít nhất 2 nguồn trước khi trình bày số liệu tài chính/vàng.

### 3. Execution Engine (`agent_executor.py`)
Vòng lặp thực thi thông minh hoạt động liên tục cho đến khi đạt mục tiêu hoặc yêu cầu can thiệp.

---

## 📂 Cấu trúc Dự án

```text
hatai-remote/
├── backend/                # Hệ thống xử lý trung tâm (FastAPI)
│   ├── api/routes/         # Các Endpoint (Auth, AI, Memory, Agent, Skills)
│   ├── core/               # Trí tuệ cốt lõi (Executor, RAG Engine, Learner)
│   ├── db/psql/            # Database schema cho User & Roles
│   ├── data/               # Kho dữ liệu Memory (Episodes, ChromaDB, Soul)
│   └── main.py             # Entrypoint server
├── frontend/               # Giao diện người dùng Premium
│   ├── src/pages/          # Brain (Memory Control), Chat, Admin, Skills
│   ├── src/components/     # UI Elements, Layout, Modals
│   └── index.css           # Design tokens (Aesthetics focus)
├── setup.sh                # Script cài đặt tự động
└── start.sh                # Script khởi động hệ thống
```
---

## 🚀 Hướng dẫn Vận hành

### 1. Cài đặt nhanh
```bash
./setup.sh
```
### 2. Khởi động
```bash
./start.sh
```
Hệ thống chạy tại: http://localhost:5173
---
## 📝 Nhật ký Phát triển (Changelog)

