// The analyst's tools. Each returns plain facts that the memo writer can cite.
// Arithmetic happens here, in code, so the LLM never has to calculate a ratio.

import { db } from './supabase.js'
import { embed } from './embeddings.js'

/** RAG retrieval: embed each sub-query, pull the closest passages, merge and rank. */
export async function searchFilings(ticker, queries, { perQuery = 5, maxTotal = 12 } = {}) {
  const emb = await embed(queries, 'query')
  const results = await Promise.all(
    emb.vectors.map((v) => db.rpc('match_chunks', { query_embedding: v, p_ticker: ticker, match_count: perQuery })),
  )
  const best = new Map()
  for (const rows of results) {
    for (const r of rows) {
      const prev = best.get(r.id)
      if (!prev || r.similarity > prev.similarity) best.set(r.id, r)
    }
  }
  const ranked = [...best.values()].sort((a, b) => b.similarity - a.similarity).slice(0, maxTotal)

  const docIds = [...new Set(ranked.map((r) => r.document_id))]
  const docs = docIds.length ? await db.select('documents', `select=id,title,doc_type,fiscal_year&id=in.(${docIds.join(',')})`) : []
  const docById = new Map(docs.map((d) => [d.id, d]))

  const passages = ranked.map((r, i) => ({
    id: `S${i + 1}`,
    chunkId: r.id,
    page: r.page,
    similarity: Number(r.similarity.toFixed(3)),
    docTitle: docById.get(r.document_id)?.title || 'Filing',
    docType: docById.get(r.document_id)?.doc_type || 'other',
    content: r.content,
  }))
  return { passages, usage: { model: emb.model, inputTokens: emb.inputTokens, outputTokens: 0, costInr: emb.costInr } }
}

/** Live market data from Yahoo Finance's public chart endpoint (NSE symbols end in .NS). */
export async function getPrice(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.NS?range=1y&interval=1wk`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`price feed HTTP ${res.status}`)
  const json = await res.json()
  const r = json?.chart?.result?.[0]
  if (!r) throw new Error('price feed returned no data')
  const closes = (r.indicators?.quote?.[0]?.close || []).filter((x) => typeof x === 'number')
  const price = r.meta.regularMarketPrice
  const yearAgo = closes[0]
  return {
    price,
    currency: r.meta.currency,
    asOf: new Date(r.meta.regularMarketTime * 1000).toISOString(),
    high52: r.meta.fiftyTwoWeekHigh,
    low52: r.meta.fiftyTwoWeekLow,
    return1y: yearAgo ? (price / yearAgo - 1) * 100 : null,
    history: closes.map((c) => Number(c.toFixed(2))),
  }
}

export async function getFinancials(ticker) {
  return db.select('financials', `ticker=eq.${encodeURIComponent(ticker)}&order=fiscal_year.desc&limit=3`)
}

const pct = (x) => (x == null || !isFinite(x) ? null : Number(x.toFixed(1)))
const growth = (now, before) => (now != null && before ? (now / before - 1) * 100 : null)

/** Deterministic ratio calculator. Returns cite-able facts T1..Tn. */
export function computeRatios({ company, financials, market }) {
  const [cur, prev] = financials
  const facts = []
  const add = (label, value, unit, detail) => {
    if (value == null || (typeof value === 'number' && !isFinite(value))) return
    facts.push({ id: `T${facts.length + 1}`, label, value, unit, detail })
  }

  if (market) {
    add('Share price', market.price, 'Rs', `NSE close, as of ${market.asOf.slice(0, 10)}`)
    add('52-week range', `${market.low52} - ${market.high52}`, 'Rs', 'Lowest and highest price over the last 52 weeks')
    add('1-year price return', pct(market.return1y), '%', 'Change in share price over the last 12 months')
  }
  if (cur) {
    const fy = cur.fiscal_year
    add(`Revenue ${fy}`, cur.revenue, 'Rs crore', company.is_bank ? 'Total income' : 'Revenue from operations')
    add(`Net profit ${fy}`, cur.net_profit, 'Rs crore', 'Profit after tax attributable to shareholders')
    if (prev) {
      add(`Revenue growth ${prev.fiscal_year} to ${fy}`, pct(growth(cur.revenue, prev.revenue)), '%', 'Year-on-year')
      add(`Profit growth ${prev.fiscal_year} to ${fy}`, pct(growth(cur.net_profit, prev.net_profit)), '%', 'Year-on-year')
    }
    if (cur.revenue) add(`Net margin ${fy}`, pct((cur.net_profit / cur.revenue) * 100), '%', 'Net profit / revenue')
    if (cur.total_equity) add(`Return on equity ${fy}`, pct((cur.net_profit / cur.total_equity) * 100), '%', 'Net profit / year-end shareholder equity')
    if (!company.is_bank && cur.total_equity && cur.total_borrowings != null)
      add(`Debt to equity ${fy}`, Number((cur.total_borrowings / cur.total_equity).toFixed(2)), 'x', 'Total borrowings / shareholder equity')
    if (market && cur.eps > 0) add('Price to earnings (P/E)', Number((market.price / cur.eps).toFixed(1)), 'x', `Current price / ${fy} basic EPS of Rs ${cur.eps}`)
    if (!cur.verified) facts.forEach((f) => { if (f.label.includes(fy)) f.detail += ' (machine-extracted, not yet human-verified)' })
  }
  return facts
}
