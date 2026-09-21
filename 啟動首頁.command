#!/bin/bash
set -e

cd "$(dirname "$0")/site-source"

if ! command -v node >/dev/null 2>&1; then
  echo "找不到 Node.js，請先到 https://nodejs.org 安裝 LTS 版本（22 以上）。"
  read -r -p "按 Enter 關閉視窗"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "第一次啟動：正在安裝網站套件，請稍候……"
  CODEX_PNPM="/Users/emc-imac1/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm"
  if [ -x "$CODEX_PNPM" ]; then "$CODEX_PNPM" install; else npx --yes pnpm@11 install; fi
fi

# API 金鑰只存在本機 .dev.vars，不會上傳。
touch .dev.vars
chmod 600 .dev.vars
if ! grep -q '^GEMINI_API_KEY=.\+' .dev.vars 2>/dev/null; then
  echo
  echo "尚未設定 Gemini API 金鑰。"
  echo "請貼上 Google AI Studio 複製的完整金鑰（輸入時不會顯示），按 Enter："
  read -r -s GEMINI_KEY
  echo
  if [ -z "$GEMINI_KEY" ]; then
    echo "未輸入金鑰，已取消。"
    read -r -p "按 Enter 關閉視窗"
    exit 1
  fi
  if [[ "$GEMINI_KEY" == *"..."* || ${#GEMINI_KEY} -lt 30 ]]; then
    echo "這不是完整的 Gemini API 金鑰。"
    echo "請到 https://aistudio.google.com/apikey 複製完整金鑰。"
    read -r -p "按 Enter 關閉視窗"
    exit 1
  fi
  printf 'GEMINI_API_KEY=%s\n' "$GEMINI_KEY" >> .dev.vars
  unset GEMINI_KEY
  echo "Gemini 金鑰已儲存到 site-source/.dev.vars。"
fi

if ! grep -q '^OPENAI_API_KEY=.\+' .dev.vars 2>/dev/null; then
  echo
  echo "尚未設定 OpenAI 備援金鑰。如要啟用備援，請貼上完整金鑰後按 Enter；不設定可直接按 Enter："
  read -r -s OPENAI_KEY
  echo
  if [ -n "$OPENAI_KEY" ]; then
    if [[ "$OPENAI_KEY" == *"..."* || ${#OPENAI_KEY} -lt 40 ]]; then
      echo "這不是完整的 OpenAI API 金鑰，已略過。"
    else
      printf 'OPENAI_API_KEY=%s\n' "$OPENAI_KEY" >> .dev.vars
      echo "OpenAI 備援金鑰已儲存。"
    fi
    unset OPENAI_KEY
  fi
fi

APPLIED=.wrangler/migrations-applied
mkdir -p "$APPLIED"
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
