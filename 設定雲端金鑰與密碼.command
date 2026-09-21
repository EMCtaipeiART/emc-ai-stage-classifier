#!/bin/bash
# 設定 Cloudflare 線上版的 Gemini／OpenAI 金鑰與團隊密碼（輸入內容不會顯示，也不會存在電腦上）
set -e
cd "$(dirname "$0")/site-source"
WORKER=$(node -e 'console.log(require("./cloudflare.deploy.json").workerName)')
wrangler() { node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js "$@"; }

echo "即將設定 Cloudflare Worker「$WORKER」的密鑰。"
echo
echo "【1/3】Gemini API 金鑰：請貼上 Google AI Studio 複製的完整金鑰後按 Enter。"
echo "      不想更換請直接按 Enter 跳過。"
read -r -s KEY; echo
if [ -n "$KEY" ]; then
  if [[ "$KEY" == *"..."* || ${#KEY} -lt 30 ]]; then echo "這不是完整金鑰，已略過。"; else printf '%s' "$KEY" | wrangler secret put GEMINI_API_KEY --name "$WORKER"; fi
fi
unset KEY

echo
echo "【2/3】OpenAI API 備援金鑰：請貼上完整金鑰後按 Enter。"
echo "      不想更換請直接按 Enter 跳過。"
read -r -s KEY; echo
if [ -n "$KEY" ]; then
  if [[ "$KEY" == *"..."* || ${#KEY} -lt 40 ]]; then echo "這不是完整金鑰，已略過。"; else printf '%s' "$KEY" | wrangler secret put OPENAI_API_KEY --name "$WORKER"; fi
fi
unset KEY

echo
echo "【3/3】團隊密碼：同事登入網站用，請輸入後按 Enter（至少 8 個字）。不想更換請直接按 Enter。"
read -r -s PASS; echo
if [ -n "$PASS" ]; then
  if [ ${#PASS} -lt 8 ]; then echo "密碼太短，已略過。"; else printf '%s' "$PASS" | wrangler secret put ACCESS_PASSWORD --name "$WORKER"; fi
fi
unset PASS

echo
echo "完成。線上網址：https://$WORKER.machi-chen.workers.dev"
read -r -p "按 Enter 關閉視窗"
