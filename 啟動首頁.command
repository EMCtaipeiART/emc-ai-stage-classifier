#!/bin/bash
set -e

cd "$(dirname "$0")/site-source"

if ! command -v node >/dev/null 2>&1; then
  echo "找不到 Node.js，請先到 https://nodejs.org 安裝 LTS 版本（22 以上）。"
  read -r -p "按 Enter 關閉視窗"
  exit 1
fi

# 1. 套件（已隨資料包附上；若被刪除才重新安裝）
if [ ! -d node_modules ]; then
  echo "第一次啟動：正在安裝網站套件，請稍候……"
  CODEX_PNPM="/Users/emc-imac1/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm"
  if [ -x "$CODEX_PNPM" ]; then
    "$CODEX_PNPM" install
  else
    npx --yes pnpm@11 install
  fi
fi

# 2. OpenAI 金鑰（只存在本機 .dev.vars，不會上傳）
if ! grep -q '^OPENAI_API_KEY=.\+' .dev.vars 2>/dev/null; then
  echo
  echo "尚未設定 OpenAI API 金鑰。"
  echo "請貼上金鑰（sk- 開頭，輸入時不會顯示），按 Enter："
  read -r -s OPENAI_KEY
  echo
  if [ -z "$OPENAI_KEY" ]; then
    echo "未輸入金鑰，已取消。"
    read -r -p "按 Enter 關閉視窗"
    exit 1
  fi
  if [[ "$OPENAI_KEY" == *"..."* || ${#OPENAI_KEY} -lt 40 ]]; then
    echo "這不是完整金鑰（長度 ${#OPENAI_KEY} 字）。OpenAI 列表上的「sk-...xxxx」只是縮寫，無法使用。"
    echo "請到 https://platform.openai.com/api-keys 按「Create new secret key」，建立後立刻按 Copy 複製整串。"
    read -r -p "按 Enter 關閉視窗"
    exit 1
  fi
  umask 077
  printf 'OPENAI_API_KEY=%s\n' "$OPENAI_KEY" > .dev.vars
  unset OPENAI_KEY
  echo "金鑰已儲存到 site-source/.dev.vars。要更換金鑰請刪除這個檔案後重新啟動。"
fi

# 3. 本機歷史紀錄資料庫：逐一套用尚未執行過的 drizzle/*.sql
APPLIED=.wrangler/migrations-applied
mkdir -p "$APPLIED"
# 舊版啟動檔只記錄了第一個 migration
[ -f .wrangler/.db-ready ] && touch "$APPLIED/0000_black_captain_flint.sql"
for f in drizzle/*.sql; do
  name=$(basename "$f")
  [ -f "$APPLIED/$name" ] && continue
  echo "正在更新本機資料庫：$name"
  [ -f dist/server/wrangler.json ] || node scripts/run-framework.mjs build
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js \
    d1 execute DB --local --config dist/server/wrangler.json \
    --persist-to .wrangler/state --file "$f"
  touch "$APPLIED/$name"
done

echo
echo "網站啟動後，請在瀏覽器開啟 http://localhost:5173/"
echo "要停止網站，請按 Control + C。"
echo

node scripts/run-framework.mjs dev
