// Minimal Gemini REST client: JSON-mode generation with model fallback, and
// batch embeddings. Every call returns token usage so the pipeline can cost it.

import { costInr } from './cost.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Each tier is a fallback chain: if the first model is overloaded (503/429),
// the next one answers instead. Popular models spike in demand without warning.
export const MODELS = {
  writer: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'],
  light:  ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
  embed:  'gemini-embedding-2',
}
export const EMBED_DIMS = 768

function apiKey() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  return key
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
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
 * model on overload. Returns { data, model, inputTokens, outputTokens, costInr, ms }.
 */
export async function generateJson({ tier, system, prompt, schema, maxOutputTokens = 2048, thinking = 'low' }) {
  const chain = MODELS[tier]
  const started = Date.now()
  let lastErr
  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
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
        })
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
        return { data, model, inputTokens, outputTokens, costInr: costInr(model, inputTokens, outputTokens), ms: Date.now() - started }
      } catch (err) {
        lastErr = err
        if (!isRetryable(err)) break
        if (attempt === 0) await sleep(800)
      }
    }
  }
  throw lastErr
}

/**
 * Embed many texts. taskType is RETRIEVAL_DOCUMENT for passages and
 * RETRIEVAL_QUERY for questions. Returns { vectors, inputTokens, costInr }.
 */
export async function embed(texts, taskType) {
  const model = MODELS.embed
  const vectors = []
  let inputTokens = 0
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100)
    let json
    for (let attempt = 0; ; attempt++) {
      try {
        json = await post(`${BASE}/${model}:batchEmbedContents`, {
          requests: batch.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: EMBED_DIMS,
          })),
        })
        break
      } catch (err) {
        if (!isRetryable(err) || attempt >= 8) throw err
        await sleep(5000 * (attempt + 1)) // free-tier rate limits need a longer back-off
      }
    }
    for (const e of json.embeddings) vectors.push(e.values)
    // The batch endpoint does not report usage; estimate at ~4 characters per token.
    inputTokens += batch.reduce((n, t) => n + Math.ceil(t.length / 4), 0)
  }
  return { vectors, model, inputTokens, costInr: costInr(model, inputTokens, 0) }
}
