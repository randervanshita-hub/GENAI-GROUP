// Cost report from real logged runs: cost per session, per step, and a
// projection to 10,000 users. Writes docs/cost-report.md for the cost slide.
//
//   npm run cost-report
//   npm run cost-report -- --questions-per-user 8 --cache-hit 0.4

import { writeFile } from 'node:fs/promises'
import { db } from '../lib/supabase.js'
import { USD_TO_INR, PRICING_USD_PER_M } from '../lib/cost.js'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? Number(process.argv[i + 1]) : dflt
}
const USERS = arg('users', 10000)
const QUESTIONS_PER_USER = arg('questions-per-user', 6) // per month
const CACHE_HIT = arg('cache-hit', 0.3)                // share of questions answered from cache at scale
const FIXED_USD = { 'Supabase Pro': 25, 'Vercel Pro (1 seat)': 20 } // monthly platform plans

const runs = await db.select('runs', 'select=steps,input_tokens,output_tokens,cost_inr,latency_ms,cached,source&cached=eq.false&claims_total=not.is.null&order=created_at.desc&limit=500')
if (!runs.length) {
  console.log('No completed runs logged yet. Ask a few questions in the app or run `npm run eval` first.')
  process.exit(0)
}
const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const avg = (xs) => sum(xs) / xs.length
const sorted = (xs) => [...xs].sort((a, b) => a - b)
const median = (xs) => sorted(xs)[Math.floor(xs.length / 2)]

const perStep = {}
for (const r of runs) for (const s of r.steps || []) {
  const k = s.step
  perStep[k] ??= { model: new Map(), input: [], output: [], cost: [] }
  perStep[k].model.set(s.model, (perStep[k].model.get(s.model) || 0) + 1)
  perStep[k].input.push(s.input_tokens)
  perStep[k].output.push(s.output_tokens)
  perStep[k].cost.push(s.cost_inr)
}

const costs = runs.map((r) => Number(r.cost_inr))
const avgCost = avg(costs)
const sessions = USERS * QUESTIONS_PER_USER
const paidSessions = sessions * (1 - CACHE_HIT)
const modelInr = paidSessions * avgCost
const fixedInr = sum(Object.values(FIXED_USD)) * USD_TO_INR
const totalInr = modelInr + fixedInr

const inr = (x, d = 2) => `₹${Number(x).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`
const order = ['plan', 'retrieve', 'tools', 'draft', 'check']
const stepRows = order.filter((k) => perStep[k]).map((k) => {
  const s = perStep[k]
  const model = [...s.model.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return `| ${k} | ${model} | ${Math.round(avg(s.input)).toLocaleString('en-IN')} | ${Math.round(avg(s.output)).toLocaleString('en-IN')} | ${inr(avg(s.cost), 4)} |`
}).join('\n')

const md = `# Cost report

Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from **${runs.length} logged analyses** (not estimates).
Exchange rate used: $1 = ₹${USD_TO_INR}. Prices: Gemini paid tier, per 1M tokens, ${Object.entries(PRICING_USD_PER_M).map(([m, p]) => `${m} $${p.input}/$${p.output}`).join('; ')}.

## One typical session (one question → one fact-checked note)

| Step | Model | Input tokens | Output tokens (incl. thinking) | Cost |
|---|---|---|---|---|
${stepRows}
| **Total (mean)** | | **${Math.round(avg(runs.map((r) => r.input_tokens))).toLocaleString('en-IN')}** | **${Math.round(avg(runs.map((r) => r.output_tokens))).toLocaleString('en-IN')}** | **${inr(avgCost, 3)}** |

- Median cost per session: ${inr(median(costs), 3)} · most expensive: ${inr(Math.max(...costs), 3)}
- Median latency: ${(median(runs.map((r) => r.latency_ms)) / 1000).toFixed(1)} s

## At ${USERS.toLocaleString('en-IN')} users a month

Assumptions: ${QUESTIONS_PER_USER} questions per user per month, ${(CACHE_HIT * 100).toFixed(0)}% answered from cache (popular companies and questions repeat).

| Item | Monthly |
|---|---|
| Sessions | ${sessions.toLocaleString('en-IN')} (${Math.round(paidSessions).toLocaleString('en-IN')} hit the models) |
| Model usage | ${inr(modelInr, 0)} |
${Object.entries(FIXED_USD).map(([k, v]) => `| ${k} | ${inr(v * USD_TO_INR, 0)} |`).join('\n')}
| **Total** | **${inr(totalInr, 0)}** (≈ ${inr(totalInr / USERS)} per user) |

## What we would change at that scale

1. **Pre-generate notes** for the 20 most-asked questions per company each quarter, after results. Most traffic then costs nothing at request time.
2. **Cache retrieval and plans**, not just whole answers, so similar questions skip the planning and search steps.
3. **Batch API for evaluations and pre-generation** (about half price, not latency-sensitive).
4. **Move the planner to a smaller or open model** (e.g. a self-hosted Gemma) once traffic justifies a GPU, keeping the strong model only for writing.
5. **Watch the January 2027 price rise**: gemini-3.8-flash's promo price doubles, so the writer step's cost doubles unless we switch models.
`
await writeFile('docs/cost-report.md', md)
console.log(md)
