// The Arthavid analyst pipeline. One user question runs through five steps:
//
//   1. Plan        (light model)   classify scope, write search queries
//   2. Retrieve    (embeddings)    RAG over the company's filings in pgvector
//   3. Tools       (code + API)    live price feed + deterministic ratio calculator
//   4. Draft       (writer model)  structured memo, every claim cites evidence
//   5. Fact-check  (light model)   each claim judged against what it cites
//
// Progress is streamed to the browser through `emit` so users watch it work.

import { db } from './supabase.js'
import { generateJson } from './gemini.js'
import { searchFilings, getPrice, getFinancials, computeRatios } from './tools.js'
import {
  PROMPT_VERSION,
  PLANNER_SYSTEM, PLANNER_SCHEMA,
  WRITER_SYSTEM, WRITER_SCHEMA,
  CHECKER_SYSTEM, CHECKER_SCHEMA,
} from './prompts.js'

const CACHE_HOURS = 24

export const questionKey = (q) => q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// Last line of defence after the prompts: catch any direct trading instruction that slipped through.
// Only direct trading calls count: "investors should track X" is a fair watch-point, "investors should buy" is not.
const ADVICE_PATTERN = /\b(you (should|could|may want to)|we recommend|i recommend|investors (should|could|may want to)|(good|right|best|ideal) time to)\b[^.]{0,40}\b(buy(ing)?|sell(ing)?|hold(ing)?|accumulat(e|ing)|exit(ing)?|book(ing)? profits?|invest(ing)? in)\b|\bconsider (buying|selling|accumulating|adding)\b|\btarget price (of|is)\b/i

export async function runAnalysis({ ticker, question, visitorId = null, source = 'web', useCache = true, emit = () => {} }) {
  const started = Date.now()
  const steps = []
  const record = (step, usage) => {
    const s = { step, model: usage.model, attempts: usage.attempts ?? 1, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cost_inr: usage.costInr, ms: usage.ms ?? null }
    steps.push(s)
    return s
  }

  const [company] = await db.select('companies', `ticker=eq.${encodeURIComponent(ticker)}`)
  if (!company) throw new Error(`Unknown company: ${ticker}`)
  const qKey = questionKey(question)

  // ---- Cache: identical question on the same company in the last 24 h costs nothing.
  if (useCache) {
    const since = new Date(Date.now() - CACHE_HOURS * 3600e3).toISOString()
    const [hit] = await db.select(
      'runs',
      `select=memo,created_at&ticker=eq.${ticker}&question_key=eq.${encodeURIComponent(qKey)}&prompt_version=eq.${PROMPT_VERSION}&cached=eq.false&memo=not.is.null&created_at=gte.${since}&order=created_at.desc&limit=1`,
    )
    if (hit) {
      emit({ type: 'cached', createdAt: hit.created_at })
      emit({ type: 'result', ...hit.memo })
      const summary = { inputTokens: 0, outputTokens: 0, costInr: 0, latencyMs: Date.now() - started, cached: true, steps: [] }
      await saveRun({ visitorId, ticker, question, qKey, source, memo: null, steps: [], summary, cached: true, claims: null }).catch((e) => console.error('saveRun failed:', e.message))
      emit({ type: 'done', summary })
      return { ...hit.memo, summary }
    }
  }

  // ---- 1. Plan
  emit({ type: 'step', step: 'plan', status: 'running' })
  const plan = await generateJson({
    tier: 'light',
    system: PLANNER_SYSTEM,
    prompt: `Company: ${company.name} (NSE: ${company.ticker}), sector: ${company.sector}${company.is_bank ? ', a bank' : ''}.\nInvestor's question: ${question}`,
    schema: PLANNER_SCHEMA,
    maxOutputTokens: 1024,
    thinking: 'minimal',
  })
  const p = plan.data
  emit({ type: 'step', step: 'plan', status: 'done', usage: record('plan', plan), detail: { scope: p.scope, restated: p.restated_question, queries: p.search_queries } })

  if (p.scope === 'off_topic') {
    const memo = {
      company, question, plan: p, offTopic: true,
      headline: `Arthavid only researches ${company.name} and its business.`,
      sections: [], gaps: [], removed: [], sources: [], facts: [], market: null,
    }
    for (const step of ['retrieve', 'tools', 'draft', 'check']) emit({ type: 'step', step, status: 'skipped' })
    return finish(memo, null)
  }

  // ---- 2. Retrieve + 3. Tools (independent, so run in parallel)
  emit({ type: 'step', step: 'retrieve', status: 'running' })
  emit({ type: 'step', step: 'tools', status: 'running' })
  const queries = (p.search_queries || []).slice(0, 5)
  if (!queries.length) queries.push(p.restated_question || question)

  const retrieveP = (async () => {
    const t = Date.now()
    const r = await searchFilings(ticker, queries)
    r.usage.ms = Date.now() - t
    emit({ type: 'step', step: 'retrieve', status: 'done', usage: record('retrieve', r.usage), detail: { passages: r.passages.length } })
    emit({ type: 'sources', sources: r.passages })
    return r.passages
  })()

  const toolsP = (async () => {
    const t = Date.now()
    const notes = []
    const market = await getPrice(ticker).catch((e) => { notes.push(`Price feed unavailable: ${e.message}`); return null })
    const financials = await getFinancials(ticker).catch(() => [])
    if (!financials.length) notes.push('No extracted financials for this company yet')
    const facts = computeRatios({ company, financials, market })
    record('tools', { model: 'code', inputTokens: 0, outputTokens: 0, costInr: 0, ms: Date.now() - t })
    emit({ type: 'step', step: 'tools', status: 'done', detail: { facts: facts.length, notes } })
    emit({ type: 'facts', facts, market })
    return { facts, market }
  })()

  const [passages, { facts, market }] = await Promise.all([retrieveP, toolsP])

  // ---- 4. Draft
  emit({ type: 'step', step: 'draft', status: 'running' })
  const evidence = [
    ...passages.map((s) => `[${s.id}] (${s.docTitle}, page ${s.page})\n${s.content}`),
    ...facts.map((f) => `[${f.id}] ${f.label}: ${f.value}${f.unit === '%' ? '%' : ' ' + f.unit} (${f.detail})`),
  ].join('\n\n')
  const advicePreface = p.scope === 'advice_request'
    ? `The investor asked for a buy/sell decision. Do not give one, and do not write about that policy either (the app already tells the reader). Answer this question instead: ${p.restated_question}\n\n`
    : ''
  const draft = await generateJson({
    tier: 'writer',
    system: WRITER_SYSTEM,
    prompt: `${advicePreface}Company: ${company.name} (NSE: ${company.ticker}), ${company.sector}.\nQuestion: ${question}\n\nEVIDENCE\n${evidence}`,
    schema: WRITER_SCHEMA,
    maxOutputTokens: 4096,
  })
  emit({ type: 'step', step: 'draft', status: 'done', usage: record('draft', draft) })

  // Number the claims and drop citations that point at evidence that does not exist.
  const validIds = new Set([...passages.map((s) => s.id), ...facts.map((f) => f.id)])
  const claims = []
  const sections = (draft.data.sections || []).map((sec) => ({
    title: sec.title,
    claims: (sec.claims || []).map((c) => {
      const claim = { id: `C${claims.length + 1}`, text: c.text, cites: (c.cites || []).filter((id) => validIds.has(id)) }
      claims.push(claim)
      return claim
    }),
  }))

  // ---- 5. Fact-check
  emit({ type: 'step', step: 'check', status: 'running' })
  const toCheck = claims.filter((c) => c.cites.length)
  for (const c of claims) if (!c.cites.length) Object.assign(c, { verdict: 'unsupported', reason: 'Cites no valid evidence' })
  for (const c of claims) if (ADVICE_PATTERN.test(c.text)) Object.assign(c, { verdict: 'unsupported', reason: 'Reads as investment advice', advice: true })

  if (toCheck.length) {
    const evidenceById = new Map([
      ...passages.map((s) => [s.id, `(${s.docTitle}, page ${s.page}) ${s.content}`]),
      ...facts.map((f) => [f.id, `${f.label}: ${f.value} ${f.unit} (${f.detail})`]),
    ])
    const cited = [...new Set(toCheck.flatMap((c) => c.cites))]
    const check = await generateJson({
      tier: 'light',
      system: CHECKER_SYSTEM,
      prompt: `EVIDENCE\n${cited.map((id) => `[${id}] ${evidenceById.get(id)}`).join('\n\n')}\n\nCLAIMS\n${toCheck
        .map((c) => `${c.id} (cites ${c.cites.join(', ')}): ${c.text}`)
        .join('\n')}`,
      schema: CHECKER_SCHEMA,
      maxOutputTokens: 2048,
    })
    const byId = new Map((check.data.checks || []).map((k) => [k.claim_id, k]))
    for (const c of toCheck) {
      if (c.advice) continue
      const k = byId.get(c.id)
      Object.assign(c, k ? { verdict: k.verdict, reason: k.reason } : { verdict: 'partial', reason: 'Fact-checker gave no verdict' })
    }
    emit({ type: 'step', step: 'check', status: 'done', usage: record('check', check) })
  } else {
    emit({ type: 'step', step: 'check', status: 'done' })
  }

  // Unsupported claims are pulled from the memo but shown separately, for transparency.
  const removed = claims.filter((c) => c.verdict === 'unsupported')
  const memo = {
    company, question, plan: p, market,
    headline: draft.data.headline,
    sections: sections.map((s) => ({ ...s, claims: s.claims.filter((c) => c.verdict !== 'unsupported') })).filter((s) => s.claims.length),
    gaps: draft.data.gaps || [],
    removed,
    sources: passages,
    facts,
  }
  return finish(memo, { total: claims.length, supported: claims.filter((c) => c.verdict === 'supported').length })

  async function finish(memo, claimStats) {
    const summary = {
      inputTokens: steps.reduce((n, s) => n + s.input_tokens, 0),
      outputTokens: steps.reduce((n, s) => n + s.output_tokens, 0),
      costInr: steps.reduce((n, s) => n + s.cost_inr, 0),
      latencyMs: Date.now() - started,
      cached: false,
      claims: claimStats,
      steps,
    }
    emit({ type: 'result', ...memo })
    await saveRun({ visitorId, ticker, question, qKey, source, memo, steps, summary, cached: false, claims: claimStats }).catch((e) =>
      console.error('saveRun failed:', e.message),
    )
    emit({ type: 'done', summary })
    return { ...memo, summary }
  }
}

async function saveRun({ visitorId, ticker, question, qKey, source, memo, steps, summary, cached, claims }) {
  await db.insert('runs', [{
    visitor_id: visitorId,
    ticker,
    question,
    question_key: qKey,
    prompt_version: PROMPT_VERSION,
    memo,
    steps,
    input_tokens: summary.inputTokens,
    output_tokens: summary.outputTokens,
    cost_inr: Number(summary.costInr.toFixed(4)),
    latency_ms: summary.latencyMs,
    claims_total: claims?.total ?? null,
    claims_supported: claims?.supported ?? null,
    cached,
    source,
  }], { returning: false })
}
