// 主要引擎（免費額度）。Gemini 免費額度常遇到「模型忙碌」的暫時性錯誤，
// 所以依序準備幾個模型：先用最新的，忙碌時退到較穩定的舊版，全部失敗才改用 OpenAI（付費）。
export const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
export const GEMINI_MODEL = GEMINI_MODELS[0];

/** 暫時性錯誤（忙碌、額度節流、服務暫時不可用）才值得重試或換模型；金鑰錯誤等就直接放棄。 */
export function isRetryableGeminiError(status: number, message: string) {
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  return /high demand|overloaded|unavailable|try again later|rate limit|quota/i.test(message);
}
