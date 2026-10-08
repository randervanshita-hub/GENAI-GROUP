// Minimal Gemini REST client: JSON-mode generation with model fallback.
// Every call returns token usage so the pipeline can cost it.

import { costInr } from './cost.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Each tier is a fallback chain: if the first model is overloaded or out of
// quota, the next one answers instead.
// Gemini's free tier allows only 20 requests a day for gemini-3.8-flash and
// gemini-3.5-flash, so Flash-Lite writes by default. In evaluation it reached
// 93% fully supported claims. With billing enabled, set
// WRITER_MODELS=gemini-3.8-flash,gemini-3.1-flash-lite to use the stronger writer.
const chainFromEnv = (name) => process.env[name]?.split(',').map((m) => m.trim()).filter(Boolean)
export const MODELS = {
  writer: chainFromEnv('WRITER_MODELS') ?? ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
  light:  chainFromEnv('LIGHT_MODELS') ?? ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
}

function apiKey() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  return key
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function post(url, body, timeoutMs = 60000) {
  const controller = new AbortController()
  let timer
  // The deadline covers the whole exchange, including reading the response body,
  // which can stall after the headers arrive.
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(Object.assign(new Error(`Gemini call timed out after ${timeoutMs / 1000}s`), { status: 504 }))
    }, timeoutMs)
  })
  const exchange = (async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    return { res, json: await res.json().catch(() => ({})) }
  })()
  let res, json
  try {
    ;({ res, json } = await Promise.race([exchange, deadline]))
  } catch (err) {
    // A hung or dropped call counts as overload, so the caller moves on to the next model.
    if (err.status) throw err
    throw Object.assign(new Error(err.message), { status: 504 })
  } finally {
    clearTimeout(timer)
  }
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
const CALL_TIMEOUT_MS = 25000 // live questions; offline jobs pass a longer timeoutMs

export async function generateJson({ tier, system, prompt, schema, maxOutputTokens = 2048, thinking = 'low', timeoutMs = CALL_TIMEOUT_MS }) {
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
        }, timeoutMs)
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
        // A daily quota will not clear in a second: go straight to the next model.
        if (!isRetryable(err) || /PerDay|per day/i.test(err.message)) break
        if (attempt === 0) await sleep(800)
      }
    }
  }
  throw lastErr
}
