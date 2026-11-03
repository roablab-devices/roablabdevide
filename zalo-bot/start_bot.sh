#!/bin/bash
cd "$(dirname "$0")"

echo "========================================================"
echo "  KHOI DONG ZALO BOT LAB (UBUNTU / LINUX)"
echo "========================================================"
echo ""

if ! command -v node &> /dev/null; then
    echo "[LOI] Khong tim thay Node.js! Vui long cai: sudo apt install nodejs npm"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "[INFO] Dang cai dat thu vien..."
    npm install
fi

echo "[INFO] Dang chay bot..."
node index.js
