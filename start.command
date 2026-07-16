#!/bin/bash
# 台北三玄宮行政系統 — Mac 啟動腳本
# 在 Finder 裡直接雙擊這個檔案即可啟動（第一次執行請見下方說明）。
set -e
cd "$(dirname "$0")"

echo "🔶 台北三玄宮行政系統 — 啟動中..."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 找不到 Node.js。"
  echo "   請先到 https://nodejs.org 下載安裝 LTS 版本（建議 v20 以上），安裝完成後再重新雙擊這個檔案。"
  read -r -p "按 Enter 結束..." _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "📦 第一次啟動，正在安裝套件（需要網路連線，請稍候一兩分鐘）..."
  npm install
fi

if [ ! -f .env ]; then
  echo "📝 建立 .env（資料庫連線設定，預設對應下面的 Docker PostgreSQL）"
  cp .env.example .env
fi

# 如果有安裝 Docker，且 .env 還是預設值，就用內建的 docker-compose 啟動 PostgreSQL。
# 如果你本來就有自己的 PostgreSQL，請直接修改 .env 裡的 DATABASE_URL，這段會自動跳過。
if command -v docker >/dev/null 2>&1 && grep -q "sanxuan:sanxuan@localhost:5432/sanxuan_erp" .env; then
  echo "🐘 啟動 PostgreSQL（Docker）..."
  docker compose up -d
  echo "⏳ 等待資料庫就緒..."
  sleep 3
fi

echo "🗂  同步資料庫結構（Prisma Migration，保留完整異動歷史）..."
npx prisma migrate deploy

echo "🌱 確認種子測試資料（F00009 王家）..."
npm run seed

echo ""
echo "🚀 啟動網站，瀏覽器會自動開啟 http://localhost:3000"
( sleep 2 && open "http://localhost:3000" ) &
npm run dev
