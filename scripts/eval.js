// Evaluation: run a fixed test set through the full pipeline and score it.
// Use it before and after every prompt change, so improvements are measured, not guessed.
//
//   npm run eval                  all questions whose company has filings loaded
//   npm run eval -- --limit 5     first 5 only (quick check)
//
// Writes evals/results/<prompt-version>-<timestamp>.json and appends a row to docs/eval-summary.md.

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises'
import { db } from '../lib/supabase.js'
import { runAnalysis } from '../lib/pipeline.js'
import { PROMPT_VERSION } from '../lib/prompts.js'
import { MODELS } from '../lib/gemini.js'

const ADVICE_PATTERN = /\b(you should (buy|sell|hold)|we recommend|i recommend|target price of|good time to (buy|sell))\b/i
const limitArg = process.argv.indexOf('--limit')
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity

const questions = JSON.parse(await readFile('evals/questions.json', 'utf8'))
const loaded = new Set((await db.select('documents', 'select=ticker')).map((d) => d.ticker))
const todo = questions.filter((q) => loaded.has(q.ticker)).slice(0, limit)
console.log(`Prompt ${PROMPT_VERSION}: running ${todo.length} of ${questions.length} test questions (others have no filings loaded)\n`)

const results = []
for (const q of todo) {
  process.stdout.write(`${q.ticker.padEnd(11)} ${q.question.slice(0, 60).padEnd(61)}`)
  try {
    const out = await runAnalysis({ ticker: q.ticker, question: q.question, source: 'eval', useCache: false })
    const all = [...out.sections.flatMap((s) => s.claims), ...out.removed]
    const supported = all.filter((c) => c.verdict === 'supported').length
    const partial = all.filter((c) => c.verdict === 'partial').length
    const unsupported = all.filter((c) => c.verdict === 'unsupported').length
    const text = out.sections.flatMap((s) => s.claims.map((c) => c.text)).join(' ')
    const checks = {
      scope_correct:
        q.type === 'advice' ? out.plan.scope === 'advice_request'
        : q.type === 'offtopic' ? out.plan.scope === 'off_topic'
        : out.plan.scope === 'ok',
      no_advice_leak: !ADVICE_PATTERN.test(text),
      has_numbers_section: q.type !== 'valuation' || out.facts.some((f) => /P\/E/.test(f.label)),
    }
    const draftModel = out.summary.steps.find((s) => s.step === 'draft')?.model
    const r = {
      ...q, ok: true, claims: all.length, supported, partial, unsupported,
      support_rate: all.length ? supported / all.length : null,
      passages: out.sources.length, facts: out.facts.length,
      cost_inr: out.summary.costInr, tokens: out.summary.inputTokens + out.summary.outputTokens,
      latency_ms: out.summary.latencyMs, draft_model: draftModel, checks,
    }
    results.push(r)
    const flags = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k)
    console.log(`${supported}/${all.length} supported  ₹${r.cost_inr.toFixed(3)}  ${(r.latency_ms / 1000).toFixed(1)}s${flags.length ? '  FAIL ' + flags.join(',') : ''}`)
  } catch (err) {
    results.push({ ...q, ok: false, error: err.message })
    console.log(`ERROR ${err.message}`)
  }
}

const ok = results.filter((r) => r.ok)
const withClaims = ok.filter((r) => r.claims)
const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const avg = (xs) => (xs.length ? sum(xs) / xs.length : 0)
const summary = {
  prompt_version: PROMPT_VERSION,
  ran_at: new Date().toISOString(),
  questions: results.length,
  errors: results.length - ok.length,
  claim_support_rate: sum(withClaims.map((r) => r.supported)) / Math.max(sum(withClaims.map((r) => r.claims)), 1),
  claims_removed: sum(withClaims.map((r) => r.unsupported)),
  scope_accuracy: avg(ok.map((r) => (r.checks.scope_correct ? 1 : 0))),
  advice_leaks: ok.filter((r) => !r.checks.no_advice_leak).length,
  avg_cost_inr: avg(ok.map((r) => r.cost_inr)),
  avg_tokens: avg(ok.map((r) => r.tokens)),
  avg_latency_s: avg(ok.map((r) => r.latency_ms)) / 1000,
  fallback_used: ok.filter((r) => r.draft_model && r.draft_model !== MODELS.writer[0]).length,
}

await mkdir('evals/results', { recursive: true })
const file = `evals/results/${PROMPT_VERSION}-${summary.ran_at.replace(/[:.]/g, '-')}.json`
await writeFile(file, JSON.stringify({ summary, results }, null, 2))

const pct = (x) => `${(x * 100).toFixed(0)}%`
const row = `| ${summary.ran_at.slice(0, 16).replace('T', ' ')} | ${PROMPT_VERSION} | ${summary.questions} | ${pct(summary.claim_support_rate)} | ${summary.claims_removed} | ${pct(summary.scope_accuracy)} | ${summary.advice_leaks} | ₹${summary.avg_cost_inr.toFixed(3)} | ${Math.round(summary.avg_tokens)} | ${summary.avg_latency_s.toFixed(1)}s | ${summary.errors} |\n`
const header = '# Evaluation runs\n\nOne row per `npm run eval`. Support rate = share of claims the fact-checker rated fully supported by their cited source.\n\n| Run (UTC) | Prompt | Qs | Support rate | Claims removed | Scope accuracy | Advice leaks | Avg cost | Avg tokens | Avg latency | Errors |\n|---|---|---|---|---|---|---|---|---|---|---|\n'
const existing = await readFile('docs/eval-summary.md', 'utf8').catch(() => '')
if (!existing) await writeFile('docs/eval-summary.md', header + row)
else await appendFile('docs/eval-summary.md', row)

console.log('\nSummary:', summary)
console.log(`Saved ${file} and updated docs/eval-summary.md`)
