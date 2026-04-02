#!/bin/bash
# ============================================================
#  HatAI Remote — Start Script
#  Ctrl+C / thoát → dừng TẤT CẢ process liên quan
# ============================================================
DIR="$(cd "$(dirname "$0")" && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

PIDFILE="$DIR/.hatai.pids"

# ── Cleanup: dừng mọi thứ ─────────────────────────────────
cleanup() {
    echo -e "\n${YELLOW}⏹  Đang dừng HatAI Remote...${RESET}"

    # 1. Kill các PID đã lưu (TERM rồi KILL)
    if [ -f "$PIDFILE" ]; then
        while IFS= read -r pid; do
            kill -0 "$pid" 2>/dev/null && kill -TERM "$pid" 2>/dev/null
        done < "$PIDFILE"
        sleep 1
        while IFS= read -r pid; do
            kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null
        done < "$PIDFILE"
        rm -f "$PIDFILE"
    fi

    # 2. Kill toàn bộ process group (bắt subprocess con uvicorn --reload)
    [ -n "$BACKEND_PID" ]  && { kill -TERM -- -"$BACKEND_PID"  2>/dev/null; sleep 0.5; kill -KILL -- -"$BACKEND_PID"  2>/dev/null; }
    [ -n "$FRONTEND_PID" ] && { kill -TERM -- -"$FRONTEND_PID" 2>/dev/null; sleep 0.5; kill -KILL -- -"$FRONTEND_PID" 2>/dev/null; }

    # 3. Quét theo tên (phòng sót)
    pkill -f "uvicorn main:app" 2>/dev/null
    pkill -f "uvicorn code_server:app" 2>/dev/null
    pkill -f "vite.*--host"     2>/dev/null

    # 4. Giải phóng cổng còn bị giữ
    for port in 8000 8001 5173; do
        local_pid=$(lsof -ti :"$port" 2>/dev/null)
        [ -n "$local_pid" ] && echo -e "  ${YELLOW}Giải phóng cổng $port${RESET}" && kill -KILL $local_pid 2>/dev/null
    done

    echo -e "${GREEN}✓ Đã dừng tất cả.${RESET}\n"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# ── Giải phóng cổng nếu bị chiếm sẵn ─────────────────────
free_port() {
    local pid; pid=$(lsof -ti :"$1" 2>/dev/null)
    if [ -n "$pid" ]; then
        echo -e "${YELLOW}⚠  Cổng $1 đang bị chiếm (PID $pid) — đang giải phóng...${RESET}"
        kill -KILL $pid 2>/dev/null; sleep 0.5
    fi
}

echo -e "${GREEN}══════════════════════════════════════${RESET}"
echo -e "${GREEN}  🚀 HatAI Remote — Starting...${RESET}"
echo -e "${GREEN}══════════════════════════════════════${RESET}"

> "$PIDFILE"
free_port 8000
free_port 8001
free_port 5173

# ── Main Backend ──────────────────────────────────────────
echo -e "${GREEN}▶ Main Backend (Port 8000)...${RESET}"
cd "$DIR/backend"
/Users/nguyenhat/miniconda3/bin/uvicorn main:app \
    --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo "$BACKEND_PID" >> "$PIDFILE"
sleep 1

# ── Code Server ───────────────────────────────────────────
echo -e "${GREEN}▶ Code Server (Port 8001)...${RESET}"
/Users/nguyenhat/miniconda3/bin/uvicorn code_server:app \
    --host 0.0.0.0 --port 8001 --reload &
CODE_SERVER_PID=$!
echo "$CODE_SERVER_PID" >> "$PIDFILE"
sleep 1

# ── Frontend ──────────────────────────────────────────────
echo -e "${GREEN}▶ Frontend (Vite)...${RESET}"
cd "$DIR/frontend"
npm run dev -- --host &
FRONTEND_PID=$!
echo "$FRONTEND_PID" >> "$PIDFILE"
sleep 1

# ── Kiểm tra khởi động ────────────────────────────────────
kill -0 "$BACKEND_PID"      2>/dev/null || echo -e "${RED}✗ Main Backend thất bại!${RESET}"
kill -0 "$CODE_SERVER_PID"  2>/dev/null || echo -e "${RED}✗ Code Server thất bại!${RESET}"
kill -0 "$FRONTEND_PID"     2>/dev/null || echo -e "${RED}✗ Frontend thất bại!${RESET}"

LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null \
    || ipconfig getifaddr en1 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}')

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════${RESET}"
echo -e "  Main Backend : ${YELLOW}http://localhost:8000${RESET}"
echo -e "  Code Server  : ${YELLOW}http://localhost:8001${RESET}"
echo -e "  Frontend     : ${YELLOW}http://localhost:5173${RESET}"
echo -e "  LAN      : ${YELLOW}http://${LOCAL_IP}:5173${RESET}"
echo -e "${GREEN}══════════════════════════════════════════════════════${RESET}"
echo -e "  ${YELLOW}Ctrl+C${RESET} để dừng TẤT CẢ services.\n"

wait
