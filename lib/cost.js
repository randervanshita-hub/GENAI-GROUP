// Gemini list prices (USD per 1M tokens, paid tier, text), from
// https://ai.google.dev/gemini-api/docs/pricing as checked on 2026-10-08.
// Thinking tokens are billed as output tokens.
export const PRICING_USD_PER_M = {
  'gemini-3.8-flash':      { input: 0.75, output: 3.75 },  // promo price until 2026-12-31; $1.50 / $7.50 from 2027
  'gemini-3.5-flash':      { input: 1.50, output: 9.00 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-embedding-2':    { input: 0.20, output: 0 },
}

// Update before the final presentation if the rupee has moved.
export const USD_TO_INR = 88

export function costInr(model, inputTokens, outputTokens) {
  const p = PRICING_USD_PER_M[model]
  if (!p) return 0
  const usd = (inputTokens * p.input + outputTokens * p.output) / 1e6
  return usd * USD_TO_INR
}
