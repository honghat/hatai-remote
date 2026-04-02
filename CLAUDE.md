# 🤖 HatAI Remote — HatAI v3

HatAI v3 là một **trợ lý AI có ý thức và khả năng tự học liên tục**. Thay thế các workflow tĩnh bằng **Kiến trúc Bộ nhớ Thống nhất (Unified Memory Architecture)**, Agent không chỉ giao tiếp mà còn "ghi nhớ" mọi tương tác, rút kinh nghiệm từ lỗi sai và tự động xây dựng kho kiến thức (RAG) của riêng mình.

---

## 🧭 Tầm nhìn & Sứ mệnh
Biến AI từ một công cụ xử lý lệnh đơn thuần thành một cộng sự số thực thụ, có khả năng:
- **Tự học (Self-Learning)**: Phân tích lịch sử công tác để cập nhật sở thích người dùng và bài học kinh nghiệm.
- **Bộ nhớ vĩnh cửu (Persistent Memory)**: Duy trì trạng thái công việc và kiến thức qua nhiều phiên làm việc khác nhau.
- **Hành động tự chủ (Autonomous Agency)**: Tự lập kế hoạch và sử dụng các công cụ hệ thống để hoàn thành mục tiêu phức tạp.

---

## 🏗 Hệ thống Công nghệ (Tech Stack)

| Thành phần | Công nghệ sử dụng |
| :--- | :--- |
| **Frontend** | React 18, Vite, TailwindCSS (Theme: Premium Dark & Glassmorphism) |
| **Backend** | FastAPI, Python 3.10+, SQLAlchemy (PostgreSQL 16) |
| **AI Engine** | llama-cpp-python (Local), Gemini API, Ollama (Multi-provider) |
| **Vector DB** | ChromaDB (RAG Knowledge Base) |
| **Local Model** | Qwen3-4B-Q4_K_M (Tối ưu cho Metal GPU/Mac) |

---

## 🛠 Kiến trúc Hệ thống v3

### 1. Unified Memory Manager (`memory.py`)
Hệ thống quản lý trạng thái tập trung cho Agent:
- **Soul (Linh hồn)**: Định hướng nhân cách và chỉ thị cốt lõi.
- **Preferences (Sở thích)**: Ghi nhớ thói quen người dùng (VD: thích code ngắn gọn).
- **Episodes (Hồi ức)**: Lưu trữ các bản tóm tắt công việc đã thực hiện.
- **Knowledge (Kiến thức)**: Hệ thống RAG lưu trữ dữ liệu tìm kiếm và hướng dẫn long-term.
- **Scratchpad (Ghi chú)**: Bộ nhớ tạm thời trong quá trình thực thi task.

### 2. Self-Learning Loop (`learner.py`)
Sau mỗi tác vụ, Agent kích hoạt tiến trình phân tích ngầm:
1. Trích xuất bài học từ các sai sót hoặc thành công.
2. Cập nhật hồ sơ sở thích của người dùng.
3. Tóm tắt nội dung để lưu vào bộ nhớ Episodic.

### 3. Execution Engine (`agent_executor.py`)
Vòng lặp thực thi thông minh:
- Tự động nạp ngữ cảnh từ bộ nhớ liên quan.
- Xử lý các tool calls (Shell, File, Browser, Office...) liên tục cho đến khi đạt mục tiêu.
- Tự động tóm tắt ngữ cảnh khi vượt quá token limit.

---

## 📂 Cấu trúc Dự án

```text
hatai-remote/
├── backend/                # Hệ thống xử lý trung tâm
│   ├── api/routes/         # Các Endpoint (Auth, AI, Code, Memory, Agent)
│   ├── core/               # logic cốt lõi (Executor, Memory, RAG, Learner)
│   ├── db/psql/            # Database schema & session
│   ├── data/               # Kho dữ liệu AI (Episodes, ChromaDB, Soul...)
│   └── main.py             # Entrypoint của hệ thống
├── frontend/               # Giao diện người dùng Premium
│   ├── src/pages/          # Chat, Brain (Quản lý bộ nhớ), Code Control, Tasks
│   ├── src/components/     # UI Elements, Layout, PrivateRoute
│   └── index.css           # Design tokens (Glassmorphism, Dark Mode)
├── setup.sh                # Script cài đặt tự động
└── start.sh                # Script khởi động hệ thống
```

---

## 🤖 Guidelines for AI Agent (Technical)

To maintain system integrity and performance, follow these directives:

- **Path Restrictions**: Only access files within `/Users/nguyenhat`, `/Volumes/HatAI`, or `/tmp`.
- **Memory Integrity**: Never write directly to files in `data/`. Always use `MemoryManager.get()` methods to ensure thread safety and consistency.
- **Step-by-Step Execution**: Always provide a thought process block before calling tools.
- **SSE Continuity**: Ensure streaming responses are handled gracefully. If a loop is stuck, request user intervention.
- **Documenting Changes**: After significant updates, use `update_docs` to log the change in this file's Changelog section.

---

## 🚀 Hướng dẫn Vận hành

### 1. Cài đặt nhanh
```bash
cd /Users/nguyenhat/Public/hatai-remote
chmod +x setup.sh start.sh
./setup.sh
```

### 2. Khởi động
```bash
./start.sh
```
Hệ thống sẽ chạy đồng thời:
- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:8000
- **Tài liệu API**: http://localhost:8000/docs

### 3. Tài khoản mặc định
- **Tài khoản**: `admin`
- **Mật khẩu**: `admin123`

---

## 📝 Nhật ký Phát triển (Changelog)

- **[2026-03-29]** Tích hợp tính năng **Background Task Runner** độc lập. Agent có thể tự động sinh tool `create_background_task` qua chat.
- **[2026-03-29]** Hợp nhất tài liệu dự án vào `CLAUDE.md`, chuẩn hóa ngôn ngữ chuyên nghiệp (Vietnamese/English Hybrid). Cập nhật API `update_docs` để hướng về file này.
- **[2026-03-28]** Tối ưu hóa RAG Engine: Lazy loading cho Embedding model, sửa lỗi Unicode trong tên Topic, giảm noise logging cho Daemon.
- **[2026-03-27]** Triển khai Autonomous Agent Loop v3: Hoạt động liên tục không giới hạn bước cho đến khi hoàn thành mục tiêu.
- **[2026-03-26]** Ra mắt Giao diện Brain Page: Cho phép quản lý trực tiếp tâm hồn và ký ức của AI.
- **[2026-03-25]** Khởi tạo nền tảng HatAI v3 với Unified Memory kiến trúc mới.

---
*Tài liệu này được duy trì bởi HatAI Agent — Cập nhật lần cuối: 29/03/2026*
