// Minimal Gemini REST client: JSON-mode generation with model fallback.
// Every call returns token usage so the pipeline can cost it.

import { costInr } from './cost.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Each tier is a fallback chain: if the first model is overloaded (503/429),
// the next one answers instead. Popular models spike in demand without warning.
export const MODELS = {
  writer: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'],
  light:  ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
}

function apiKey() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  return key
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function post(url, body, timeoutMs = 60000) {
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    // A hung call counts as overload, so the caller moves on to the next model.
    const e = new Error(err.name === 'TimeoutError' ? `Gemini call timed out after ${timeoutMs / 1000}s` : err.message)
    e.status = 504
    throw e
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Gemini HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return json
}

const isRetryable = (err) => [429, 500, 503, 504].includes(err.status)

/**
 * Generate structured JSON. Tries each model in the chain, with one retry per
 * model on overload, and a per-call time limit so one hung request cannot stall
 * the pipeline. Returns { data, model, attempts, inputTokens, outputTokens, costInr, ms }.
 */
const CALL_TIMEOUT_MS = 25000

export async function generateJson({ tier, system, prompt, schema, maxOutputTokens = 2048, thinking = 'low' }) {
  const chain = MODELS[tier]
  const started = Date.now()
  let lastErr
  let attempts = 0
  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      attempts++
      try {
        const json = await post(`${BASE}/${model}:generateContent`, {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens,
            responseMimeType: 'application/json',
            ...(schema ? { responseSchema: schema } : {}),
            thinkingConfig: { thinkingLevel: thinking },
          },
        }, CALL_TIMEOUT_MS)
        const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
        const u = json.usageMetadata || {}
        const inputTokens = u.promptTokenCount || 0
        const outputTokens = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)
        let data
        try {
          data = JSON.parse(text)
        } catch {
          const e = new Error(`${model} returned invalid JSON`)
          e.status = 500
          throw e
        }
        return { data, model, attempts, inputTokens, outputTokens, costInr: costInr(model, inputTokens, outputTokens), ms: Date.now() - started }
      } catch (err) {
        lastErr = err
        if (!isRetryable(err)) break
        if (attempt === 0) await sleep(800)
      }
    }
  }
  throw lastErr
}
