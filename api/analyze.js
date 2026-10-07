// POST /api/analyze { ticker, question, visitorId }
// Streams newline-delimited JSON events while the pipeline runs, so the page
// can show each step as it happens.

import { db } from '../lib/supabase.js'
import { runAnalysis } from '../lib/pipeline.js'

export const maxDuration = 120

const DAILY_CAP_PER_VISITOR = 15
const MAX_QUESTION_CHARS = 400

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') return JSON.parse(req.body)
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

function fail(res, status, error, message) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error, message }))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', 'Use POST')

  let body
  try {
    body = await readBody(req)
  } catch {
    return fail(res, 400, 'bad_json', 'Request body must be JSON')
  }
  const ticker = String(body.ticker || '').toUpperCase().replace(/[^A-Z0-9&-]/g, '')
  const question = String(body.question || '').trim()
  const visitorId = String(body.visitorId || '').slice(0, 64) || null
  if (!ticker) return fail(res, 400, 'missing_ticker', 'Pick a company first')
  if (question.length < 5) return fail(res, 400, 'missing_question', 'Ask a question of at least a few words')
  if (question.length > MAX_QUESTION_CHARS) return fail(res, 400, 'question_too_long', `Keep questions under ${MAX_QUESTION_CHARS} characters`)

  // Protects the shared API budget during the public demo.
  if (visitorId) {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString()
    const used = await db.select('runs', `select=id&visitor_id=eq.${encodeURIComponent(visitorId)}&cached=eq.false&created_at=gte.${since}`).catch(() => [])
    if (used.length >= DAILY_CAP_PER_VISITOR)
      return fail(res, 429, 'cap_reached', `You've used today's ${DAILY_CAP_PER_VISITOR} free analyses. Cached questions still work.`)
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  const emit = (event) => res.write(JSON.stringify(event) + '\n')

  try {
    await runAnalysis({ ticker, question, visitorId, emit })
  } catch (err) {
    console.error('analyze error:', err)
    emit({ type: 'error', message: err.status === 503 || err.status === 429
      ? 'The AI models are overloaded right now. Please try again in a minute.'
      : 'Something went wrong while researching. Please try again.' })
  }
  res.end()
}
