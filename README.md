# EMC AI 階段判定器

上傳設計需求單截圖（或公開的 Google Slides），優先使用 Gemini `gemini-3.6-flash` 免費額度判定案件為「新製」、「再製」或「資訊不足」；Gemini 不可用時會自動改用 OpenAI `gpt-5-mini` 備援。系統會記錄每次分析的附件、實際引擎、token 用量與備援費用。

- 線上版（Cloudflare Workers，需團隊密碼）：https://emc-ai-stage-classifier.machi-chen.workers.dev
- 技術：vinext（Next.js App Router on Vite）+ Cloudflare Workers、D1、KV／R2

## 資料夾

| 路徑 | 內容 |
| --- | --- |
| `site-source/` | 網站原始碼 |
| `site-source/skills/emc-stage-classifier/SKILL.md` | **判定規則**，網站分析時直接讀取 |
| `codex-skill/emc-stage-classifier/` | 同一份規則的 Codex Skill 副本 |
| `啟動首頁.command` | macOS 本機啟動（雙擊） |
| `設定雲端金鑰與密碼.command` | 設定 Cloudflare 線上版的 Gemini／OpenAI 金鑰與團隊密碼（雙擊） |

## 判定規則

- **再製**（須全部成立）：已有可直接沿用的完整版型或完成稿；只需等比例縮放、延伸或裁切；單純更換文案、價格、日期或圖片（含英翻中）；不需要重建主要構圖與資訊層級。上面新增資訊或圖示就不算再製。
- **新製**（符合任一項）：從零建立視覺；素材（影片、產品圖、Logo）只作內容來源；在素材上新增標題、價格、CTA、徽章等；比例差異迫使主要元素重新配置。
- 需求單上的參考圖要分辨是「企劃示意稿」（拼貼、可見播放器介面）還是「既有完成畫面」。

修改規則只要改 `site-source/skills/emc-stage-classifier/SKILL.md`，再複製到 `codex-skill/`，重新啟動或重新部署即生效。

## 本機使用（macOS）

需要 Node.js 22 以上。

1. 雙擊 `啟動首頁.command`。第一次會安裝套件、要求貼上完整的 Gemini API 金鑰，並可另外設定 OpenAI 備援金鑰（都存在 `site-source/.dev.vars`，不會進 git），並建立本機資料庫。
2. 開啟 http://localhost:5173/
3. 結束時在終端機按 `Control + C`。

要更換本機金鑰，刪除 `site-source/.dev.vars` 後重新啟動。

## 部署到 Cloudflare

資源設定在 `site-source/cloudflare.deploy.json`（Worker 名稱、D1 資料庫 ID、KV namespace ID；帳號未啟用 R2，附件存 KV）。

```bash
cd site-source
npm run deploy:cloudflare
```

這個指令會建置網站、套用 `drizzle/` 裡尚未執行的 D1 migration，並上傳 Worker。需要先用 `wrangler login` 登入 Cloudflare。

第一次部署後，雙擊 `設定雲端金鑰與密碼.command` 設定：

- `GEMINI_API_KEY`：Gemini API 金鑰（主要引擎，免費額度）
- `OPENAI_API_KEY`：OpenAI API 金鑰（Gemini 失敗時的備援）
- `ACCESS_PASSWORD`：團隊密碼。設定後所有頁面與 API 都要先登入；未設定時網站不設防。

## 串接 EMC 設計需求系統

設計需求系統前台（https://emctaipeiart.github.io）「填寫設計需求 › 階段 › Ai判斷」會直接呼叫這裡的 API：

- `POST /api/analyze`（multipart：`images`、`slidesUrl`）
- 驗證（任一即可，不使用第三方 cookie）：
  - `X-EMC-Editor-Token`：設計需求系統已登入帳號的 token，經 Service Binding `DESIGN_API`（machi-design-api）的 `verifyToken` 驗證，結果快取 5 分鐘
  - `X-EMC-Access`：未登入者以團隊密碼呼叫 `POST /api/login` 取得的 `token`
- 允許的來源：`cloudflare.deploy.json` 的 `allowedOrigins`（CORS），以及 `next.config.ts` 的 `serverActions.allowedOrigins`（vinext 會對跨站 multipart POST 做 CSRF 檢查）；本機 `localhost:8787` 供測試。

## AI 引擎與費用

主要引擎依序嘗試 `gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-2.5-flash`（`site-source/lib/models.ts`），使用 Gemini 免費額度，單次顯示費用為 0。遇到「模型忙碌」這類暫時性錯誤會先重試一次再換下一個模型，全部失敗才改用 OpenAI。OpenAI 備援單價與匯率在 `site-source/lib/pricing.ts`（gpt-5-mini：輸入 $0.25、快取輸入 $0.025、輸出 $2.00／每百萬 tokens；台幣匯率預設 32）。實際額度與帳單以 Google AI Studio 與 OpenAI 後台為準。

## 確認目前用哪個引擎

- 登入後開啟 `/api/status`（例如 https://emc-ai-stage-classifier.machi-chen.workers.dev/api/status ）：會回報 `activeProvider`、Gemini 是否可用與錯誤訊息。
- 每次分析結果都會標示實際引擎；若退回 OpenAI，會一併顯示 Gemini 失敗原因（`fallbackReason`）。

## 安全說明

- 金鑰與密碼只存在 `.dev.vars`（本機）或 Cloudflare secrets（線上），不在程式碼中。
- 線上版所有使用者共用同一份分析紀錄。
