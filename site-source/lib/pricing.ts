// OpenAI 官方單價（美元／每 100 萬 tokens）。換模型或官方調價時改這裡。
export const MODEL = "gpt-5-mini";
export const PRICE_PER_MILLION = { input: 0.25, cachedInput: 0.025, output: 2 };
// 台幣換算僅供參考，依實際帳單匯率調整
export const USD_TO_TWD = 32;

export type UsageNumbers = { input: number; cached?: number; output: number };

// input_tokens 已包含 cached tokens，快取部分改用快取單價計算；output 已含推理 tokens
export function usageCostUsd({ input, cached = 0, output }: UsageNumbers) {
  const cachedTokens = Math.min(cached, input);
  return ((input - cachedTokens) * PRICE_PER_MILLION.input
    + cachedTokens * PRICE_PER_MILLION.cachedInput
    + output * PRICE_PER_MILLION.output) / 1_000_000;
}

export function formatUsd(value: number) {
  return `US$${value < 0.01 ? value.toFixed(4) : value.toFixed(3)}`;
}

export function formatTwd(usd: number) {
  return `約 NT$${(usd * USD_TO_TWD).toFixed(2)}`;
}
