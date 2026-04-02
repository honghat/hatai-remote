#!/bin/bash
# ============================================================
#  HatAI Remote — Setup Script
#  Cài đặt PostgreSQL, tạo DB, seed user, và chạy ứng dụng
# ============================================================
set -e

COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_RED='\033[0;31m'
COLOR_RESET='\033[0m'

echo -e "${COLOR_GREEN}══════════════════════════════════════${COLOR_RESET}"
echo -e "${COLOR_GREEN}  🚀 HatAI Remote — Setup${COLOR_RESET}"
echo -e "${COLOR_GREEN}══════════════════════════════════════${COLOR_RESET}"

DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 1. Cài PostgreSQL nếu chưa có ──
echo -e "\n${COLOR_YELLOW}[1/5] Kiểm tra PostgreSQL...${COLOR_RESET}"
if ! command -v psql &>/dev/null; then
    echo "PostgreSQL chưa cài. Đang cài qua Homebrew..."
    if ! command -v brew &>/dev/null; then
        echo -e "${COLOR_RED}Homebrew chưa cài. Vui lòng cài Homebrew trước.${COLOR_RESET}"
        echo "Chạy: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        exit 1
    fi
    brew install postgresql@16
    brew services start postgresql@16
    echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
    export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
    sleep 3
    echo -e "${COLOR_GREEN}✅ PostgreSQL 16 đã được cài và khởi động.${COLOR_RESET}"
else
    echo -e "${COLOR_GREEN}✅ psql đã có: $(psql --version)${COLOR_RESET}"
fi

# ── 2. Tạo Database ──
echo -e "\n${COLOR_YELLOW}[2/5] Tạo database hatai_remote...${COLOR_RESET}"
if psql -U "$USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='hatai_remote'" | grep -q 1; then
    echo -e "${COLOR_GREEN}✅ Database hatai_remote đã tồn tại.${COLOR_RESET}"
else
    createdb -U "$USER" hatai_remote
    echo -e "${COLOR_GREEN}✅ Đã tạo database hatai_remote.${COLOR_RESET}"
fi

# ── 3. Cài Python dependencies ──
echo -e "\n${COLOR_YELLOW}[3/5] Cài đặt Python dependencies...${COLOR_RESET}"
cd "$DIR/backend"
pip install -r requirements.txt 2>&1 | tail -3
echo -e "${COLOR_GREEN}✅ Python dependencies đã cài.${COLOR_RESET}"

# ── 4. Tạo bảng và seed user mặc định ──
echo -e "\n${COLOR_YELLOW}[4/5] Khởi tạo database tables + seed user...${COLOR_RESET}"
cd "$DIR/backend"
python -c "
import sys
sys.path.insert(0, '.')
from core.config import DB_CONFIG
from db.psql.session import engine, Base
from db.psql.models import *
from hashlib import sha256

# Tạo tất cả bảng
Base.metadata.create_all(bind=engine)
print('✅ Tất cả bảng đã được tạo.')

# Seed admin user
from db.psql.session import SessionLocal
db = SessionLocal()
from db.psql.models.user import User
admin = db.query(User).filter(User.username == 'admin').first()
if not admin:
    admin = User(
        username='admin',
        password=sha256('admin123'.encode()).hexdigest(),
        email='admin@hatai.local',
        full_name='Admin HatAI',
        role_id=1,
    )
    db.add(admin)
    db.commit()
    print('✅ Tạo user mặc định: admin / admin123')
else:
    print('✅ User admin đã tồn tại.')
db.close()
"
echo -e "${COLOR_GREEN}✅ Database đã khởi tạo xong.${COLOR_RESET}"

# ── 5. Cài Frontend ──
echo -e "\n${COLOR_YELLOW}[5/5] Cài đặt Frontend dependencies...${COLOR_RESET}"
cd "$DIR/frontend"
npm install 2>&1 | tail -3
echo -e "${COLOR_GREEN}✅ Frontend dependencies đã cài.${COLOR_RESET}"

echo -e "\n${COLOR_GREEN}══════════════════════════════════════${COLOR_RESET}"
echo -e "${COLOR_GREEN}  ✅ Setup hoàn tất!${COLOR_RESET}"
echo -e "${COLOR_GREEN}══════════════════════════════════════${COLOR_RESET}"
echo ""
echo -e "  Để chạy ứng dụng:"
echo -e "  ${COLOR_YELLOW}cd $DIR && ./start.sh${COLOR_RESET}"
echo ""
echo -e "  Hoặc chạy thủ công:"
echo -e "  Backend:  ${COLOR_YELLOW}cd backend && uvicorn main:app --host 0.0.0.0 --port 8000 --reload${COLOR_RESET}"
echo -e "  Frontend: ${COLOR_YELLOW}cd frontend && npm run dev${COLOR_RESET}"
echo ""
echo -e "  Đăng nhập: ${COLOR_YELLOW}admin / admin123${COLOR_RESET}"
