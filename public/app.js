// Arthavid front end: pick a company, ask a question, watch the pipeline
// stream its steps, then read a cited and fact-checked research note.

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const STEPS = [
  { key: 'plan', title: 'Plan the research' },
  { key: 'retrieve', title: 'Read the filings' },
  { key: 'tools', title: 'Price feed and calculator' },
  { key: 'draft', title: 'Draft the note' },
  { key: 'check', title: 'Fact-check every claim' },
]

const SUGGESTIONS = {
  general: [
    'What drove revenue and profit last year?',
    'What are the biggest risks management talks about?',
    'How is the company valued today compared with its earnings?',
    'Should I buy this stock?',
  ],
  bank: [
    'How is asset quality trending?',
    'What is happening to deposit growth and margins?',
    'What are the biggest risks management talks about?',
    'Should I buy this stock?',
  ],
}

const state = { companies: [], selected: null, running: false, sources: new Map(), facts: new Map(), memo: null }

// ---------- per-viewer conveniences (safe if storage is blocked) ----------
function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key)
    localStorage.setItem(key, value)
  } catch { return null }
}
function visitorId() {
  let id = store('arthavid.visitor')
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2)
    store('arthavid.visitor', id)
  }
  return id
}

// ---------- theme ----------
const savedTheme = store('arthavid.theme')
if (savedTheme) document.documentElement.dataset.theme = savedTheme
$('themeToggle').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches
  const next = dark ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  store('arthavid.theme', next)
})

// ---------- companies ----------
async function loadCompanies() {
  try {
    const res = await fetch('/api/companies')
    const json = await res.json()
    if (!res.ok) throw new Error(json.error)
    state.companies = json.companies
    renderCompanies()
    if (!state.companies.length) $('companyList').innerHTML = '<p class="company-meta">No companies have been loaded yet. Run <code>npm run ingest</code>.</p>'
  } catch {
    $('companyList').innerHTML = '<p class="form-msg">Could not load companies. Refresh to try again.</p>'
  }
}

function renderCompanies() {
  const q = $('companySearch').value.trim().toLowerCase()
  const list = state.companies.filter((c) => !q || c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q) || c.sector.toLowerCase().includes(q))
  $('companyList').innerHTML = list.map((c) => `
    <button type="button" class="company" role="option" data-ticker="${esc(c.ticker)}" aria-selected="${state.selected?.ticker === c.ticker}">
      <span><span class="company-name">${esc(c.name)}</span><br><span class="company-meta">${esc(c.sector)} · ${c.documents.length} filing${c.documents.length === 1 ? '' : 's'}</span></span>
      <span class="ticker">${esc(c.ticker)}</span>
    </button>`).join('') || '<p class="company-meta">No match.</p>'
}

$('companySearch').addEventListener('input', renderCompanies)
$('companyList').addEventListener('click', (e) => {
  const btn = e.target.closest('.company')
  if (!btn) return
  state.selected = state.companies.find((c) => c.ticker === btn.dataset.ticker)
  renderCompanies()
  renderSuggestions()
  updateRunButton()
  $('question').focus()
})

function renderSuggestions() {
  const set = state.selected?.is_bank ? SUGGESTIONS.bank : SUGGESTIONS.general
  $('suggestions').innerHTML = set.map((s) => `<button type="button" class="chip">${esc(s)}</button>`).join('')
}
$('suggestions').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip')
  if (!chip) return
  $('question').value = chip.textContent
  updateRunButton()
})
$('question').addEventListener('input', updateRunButton)
function updateRunButton() {
  $('runBtn').disabled = state.running || !state.selected || $('question').value.trim().length < 5
}

// ---------- run ----------
$('askForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  if ($('runBtn').disabled) return
  const question = $('question').value.trim()
  const company = state.selected
  state.running = true
  updateRunButton()
  $('runBtn').textContent = 'Researching…'
  $('formMsg').textContent = ''
  state.sources = new Map()
  state.facts = new Map()
  startTrace()
  renderMemoLoading(company, question)

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: company.ticker, question, visitorId: visitorId() }),
    })
    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.message || 'Something went wrong. Please try again.')
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) handleEvent(JSON.parse(line))
      }
    }
  } catch (err) {
    $('formMsg').textContent = err.message
    document.querySelectorAll('.step[data-status="running"]').forEach((s) => (s.dataset.status = 'error'))
    if (!state.memo) $('memo').innerHTML = `<div class="memo-empty"><p class="eyebrow">No note this time</p><p>${esc(err.message)}</p></div>`
  } finally {
    state.running = false
    $('runBtn').textContent = 'Research it'
    updateRunButton()
  }
})

function handleEvent(ev) {
  switch (ev.type) {
    case 'step': return updateStep(ev)
    case 'sources': return ev.sources.forEach((s) => state.sources.set(s.id, s))
    case 'facts': return ev.facts.forEach((f) => state.facts.set(f.id, f))
    case 'cached':
      STEPS.forEach((s) => updateStep({ step: s.key, status: 'done', detail: 'Reused from an identical question in the last 24 hours' }))
      state.cachedAt = ev.createdAt
      return
    case 'result':
      ;(ev.sources || []).forEach((s) => state.sources.set(s.id, s))
      ;(ev.facts || []).forEach((f) => state.facts.set(f.id, f))
      state.memo = ev
      return renderMemo(ev)
    case 'done': return renderMeter(ev.summary)
    case 'error': throw new Error(ev.message)
  }
}

// ---------- trace ----------
function startTrace() {
  state.memo = null
  state.cachedAt = null
  $('trace').hidden = false
  $('meter').hidden = true
  $('steps').innerHTML = STEPS.map((s, i) => `
    <li class="step" data-step="${s.key}" data-status="pending">
      <span class="step-dot">${i + 1}</span>
      <div><div class="step-title">${s.title}</div><div class="step-detail"></div></div>
      <div class="step-usage"></div>
    </li>`).join('')
}

function updateStep({ step, status, usage, detail }) {
  const el = document.querySelector(`.step[data-step="${step}"]`)
  if (!el) return
  el.dataset.status = status
  if (status === 'done') el.querySelector('.step-dot').textContent = '✓'
  let text = ''
  if (typeof detail === 'string') text = detail
  else if (detail?.queries) text = (detail.scope === 'advice_request' ? 'Buy/sell question detected, answering it as research. ' : '') + `Searching: ${detail.queries.map((q) => `“${q}”`).join(', ')}`
  else if (detail?.passages != null) text = `${detail.passages} relevant passages found`
  else if (detail?.facts != null) text = `${detail.facts} figures computed${detail.notes?.length ? ` · ${detail.notes.join('; ')}` : ''}`
  if (status === 'skipped') text = 'Skipped'
  if (text) el.querySelector('.step-detail').textContent = text
  if (usage && usage.model !== 'code') {
    const tokens = usage.input_tokens + usage.output_tokens
    el.querySelector('.step-usage').innerHTML = `${esc(usage.model.replace('gemini-', ''))}<br>${tokens.toLocaleString('en-IN')} tok · ₹${usage.cost_inr.toFixed(3)}`
  } else if (usage?.model === 'code') {
    el.querySelector('.step-usage').innerHTML = `code<br>${usage.ms} ms`
  }
}

function renderMeter(s) {
  const claims = s.claims ? `${s.claims.supported}/${s.claims.total}` : '—'
  $('meter').hidden = false
  $('meter').innerHTML = [
    [`₹${s.costInr.toFixed(3)}`, s.cached ? 'Cost (served from cache)' : 'Cost of this answer'],
    [(s.inputTokens + s.outputTokens).toLocaleString('en-IN'), `Tokens (${s.inputTokens.toLocaleString('en-IN')} in / ${s.outputTokens.toLocaleString('en-IN')} out)`],
    [`${(s.latencyMs / 1000).toFixed(1)} s`, 'Time taken'],
    [claims, 'Claims fully supported'],
  ].map(([v, k]) => `<div class="meter-cell"><div class="meter-val">${v}</div><div class="meter-key">${k}</div></div>`).join('')
}

// ---------- memo ----------
function memoHeader(company, question, extra = '') {
  return `
    <div class="memo-head">
      <div>
        <div class="memo-company">${esc(company.name)} · NSE: ${esc(company.ticker)} · ${esc(company.sector)}</div>
        <p class="memo-q">“${esc(question)}”</p>
      </div>
      <div class="memo-stamp">${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${extra}</div>
    </div>`
}

function renderMemoLoading(company, question) {
  $('memo').innerHTML = memoHeader(company, question) + `
    <div style="margin-top:26px;display:flex;flex-direction:column;gap:12px">
      <div class="skeleton" style="height:34px;width:80%"></div>
      <div class="skeleton" style="height:16px"></div><div class="skeleton" style="height:16px;width:92%"></div>
      <div class="skeleton" style="height:16px;width:85%"></div>
    </div>`
}

function citeChip(id) {
  const kind = id.startsWith('T') ? 'tool' : 'src'
  return `<button type="button" class="cite ${kind}" data-cite="${esc(id)}" title="Open source ${esc(id)}">${esc(id)}</button>`
}

function sparkline(values) {
  if (!values?.length) return ''
  const w = 160, h = 38, min = Math.min(...values), max = Math.max(...values)
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / (max - min || 1)) * (h - 6)).toFixed(1)}`).join(' ')
  const up = values[values.length - 1] >= values[0]
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Weekly share price, last 12 months"><polyline points="${pts}" fill="none" stroke="var(--${up ? 'good' : 'bad'})" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`
}

function renderMarket(m) {
  if (!m) return ''
  const r = m.return1y
  const fmt = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
  return `<div class="market">
    <div><div class="mk-val">₹${fmt(m.price)}</div><div class="mk-key">Share price</div></div>
    <div><div class="mk-val ${r >= 0 ? 'up' : 'down'}">${r == null ? '—' : `${r >= 0 ? '+' : ''}${r.toFixed(1)}%`}</div><div class="mk-key">1-year return</div></div>
    <div><div class="mk-val">₹${fmt(m.low52)}</div><div class="mk-key">52-week low</div></div>
    <div><div class="mk-val">₹${fmt(m.high52)}</div><div class="mk-key">52-week high</div></div>
    <div>${sparkline(m.history)}<div class="mk-key">Weekly closes, 12 months</div></div>
  </div>`
}

function renderClaim(c) {
  const partial = c.verdict === 'partial'
  return `<p class="claim ${partial ? 'partial' : ''}">${esc(c.text)}${c.cites.map(citeChip).join('')}${partial ? `<span class="verdict-note">Partly verified: ${esc(c.reason)}</span>` : ''}</p>`
}

function renderMemo(m) {
  const company = m.company
  const stamp = state.cachedAt ? '<br><span class="badge cached">Served from cache</span>' : '<br><span class="badge">Fact-checked</span>'
  let html = memoHeader(company, m.question, stamp)
  html += `<h2 class="headline">${esc(m.headline)}</h2>`

  if (m.offTopic) {
    html += `<p class="notice">That question doesn't seem to be about ${esc(company.name)}. Try asking about its business, results, risks or valuation.</p>`
    $('memo').innerHTML = html
    return
  }
  if (m.plan?.scope === 'advice_request')
    html += `<p class="notice">Arthavid doesn't make buy or sell calls. Here is the research to help you decide: <i>${esc(m.plan.restated_question)}</i></p>`

  html += renderMarket(m.market)
  html += `<div class="legend"><span><i style="background:var(--good)"></i>Verified against source</span><span><i style="background:var(--warn)"></i>Partly verified</span><span><b class="cite src" style="cursor:default">S1</b> filing passage</span><span><b class="cite tool" style="cursor:default">T1</b> calculator or price feed</span></div>`

  for (const sec of m.sections) {
    const cls = /bull/i.test(sec.title) ? 'bull' : /bear/i.test(sec.title) ? 'bear' : ''
    html += `<section class="section ${cls}"><h4>${esc(sec.title)}</h4>${sec.claims.map(renderClaim).join('')}</section>`
  }

  if (m.gaps?.length) html += `<div class="subpanel"><h4>What the filings didn't cover</h4><ul class="gaps">${m.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>`

  if (m.removed?.length) {
    html += `<details class="removed"><summary>${m.removed.length} claim${m.removed.length === 1 ? '' : 's'} removed by the fact-checker</summary>
      ${m.removed.map((c) => `<p class="claim">${esc(c.text)}<span class="removed-reason">${esc(c.reason)}</span></p>`).join('')}</details>`
  }

  if (m.facts?.length) {
    html += `<div class="subpanel"><h4>Calculator output</h4><table class="facts"><tbody>
      ${m.facts.map((f) => `<tr><td>${esc(f.id)}</td><td>${esc(f.label)}<span class="fdetail">${esc(f.detail)}</span></td><td class="val">${esc(fmtFact(f))}</td></tr>`).join('')}
    </tbody></table></div>`
  }
  if (m.sources?.length) {
    html += `<div class="subpanel"><h4>Passages read (${m.sources.length})</h4><div class="sources-list">${m.sources.map((s) => citeChip(s.id)).join('')}</div></div>`
  }
  $('memo').innerHTML = html
}

function fmtFact(f) {
  if (typeof f.value !== 'number') return `${f.value} ${f.unit === 'Rs' ? '₹' : f.unit}`
  const n = f.value.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  if (f.unit === '%') return `${n}%`
  if (f.unit === 'x') return `${n}x`
  if (f.unit === 'Rs') return `₹${n}`
  if (f.unit === 'Rs crore') return `₹${n} cr`
  return `${n} ${f.unit}`
}

// ---------- source drawer ----------
$('memo').addEventListener('click', (e) => {
  const chip = e.target.closest('.cite[data-cite]')
  if (chip) openSource(chip.dataset.cite)
})

function openSource(id) {
  const s = state.sources.get(id)
  const f = state.facts.get(id)
  if (!s && !f) return
  const citing = (state.memo?.sections || []).flatMap((sec) => sec.claims).filter((c) => c.cites.includes(id))
  if (s) {
    $('drawerKicker').textContent = `Source ${id} · ${s.docType === 'concall' ? 'Earnings call' : s.docType === 'annual_report' ? 'Annual report' : 'Filing'}`
    $('drawerTitle').textContent = `${s.docTitle}, page ${s.page}`
    $('drawerBody').innerHTML = `
      <div class="drawer-meta"><span class="badge">Relevance ${(s.similarity * 100).toFixed(0)}%</span></div>
      <div class="drawer-text">${highlightNumbers(esc(s.content))}</div>
      ${citing.length ? `<div class="drawer-claims"><p class="eyebrow">Claims citing this passage</p>${citing.map((c) => `<p>• ${esc(c.text)}</p>`).join('')}</div>` : ''}`
  } else {
    $('drawerKicker').textContent = `Calculated figure ${id}`
    $('drawerTitle').textContent = f.label
    $('drawerBody').innerHTML = `
      <div class="drawer-text"><b>${esc(fmtFact(f))}</b>\n${esc(f.detail)}</div>
      <p class="company-meta" style="margin-top:12px">Worked out in code from figures in the annual report and the live NSE price. No AI model did this arithmetic.</p>
      ${citing.length ? `<div class="drawer-claims"><p class="eyebrow">Claims citing this figure</p>${citing.map((c) => `<p>• ${esc(c.text)}</p>`).join('')}</div>` : ''}`
  }
  $('drawer').classList.add('open')
  $('drawer').setAttribute('aria-hidden', 'false')
  $('drawerBackdrop').hidden = false
  $('drawerClose').focus()
}
const highlightNumbers = (html) => html.replace(/(₹|Rs\.?\s?)?\b\d[\d,]*(\.\d+)?\s?(%|crore|cr|bn|billion|lakh|bps)?/g, (m) => (m.trim().length > 1 ? `<mark>${m}</mark>` : m))

function closeDrawer() {
  $('drawer').classList.remove('open')
  $('drawer').setAttribute('aria-hidden', 'true')
  $('drawerBackdrop').hidden = true
}
$('drawerClose').addEventListener('click', closeDrawer)
$('drawerBackdrop').addEventListener('click', closeDrawer)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer() })

loadCompanies()
