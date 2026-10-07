// Ingestion: turn filings PDFs into searchable passages and headline financials.
//
//   data/companies.json                 list of covered companies
//   data/filings/<TICKER>/AR_FY2026.pdf          annual report
//   data/filings/<TICKER>/CONCALL_Q1FY27.pdf     earnings-call transcript
//
// Usage:
//   npm run ingest                 ingest every new PDF
//   npm run ingest -- HDFCBANK     only one company
//   npm run ingest -- --force      re-ingest PDFs already in the database
//   npm run ingest -- --financials-only INFY   only redo the financial-figures extraction

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { extractText, getDocumentProxy } from 'unpdf'
import { db } from '../lib/supabase.js'
import { generateJson } from '../lib/gemini.js'
import { embed } from '../lib/embeddings.js'
import { EXTRACT_SYSTEM, EXTRACT_SCHEMA } from '../lib/prompts.js'

const DATA = path.resolve('data')
const CHUNK_CHARS = 1500
const OVERLAP_CHARS = 200
const MIN_PAGE_CHARS = 150

const args = process.argv.slice(2)
const force = args.includes('--force')
// Re-run only the financial-figures extraction from annual reports, without re-embedding.
const financialsOnly = args.includes('--financials-only')
const only = args.filter((a) => !a.startsWith('--')).map((a) => a.toUpperCase())

let totalEmbedTokens = 0
let totalCostInr = 0

function describe(fileName) {
  const base = fileName.replace(/\.pdf$/i, '')
  const [kind, ...rest] = base.split('_')
  const period = rest.join(' ')
  if (/^AR$/i.test(kind)) return { doc_type: 'annual_report', fiscal_year: period || null, title: `Annual Report ${period}`.trim() }
  if (/^CONCALL$/i.test(kind)) return { doc_type: 'concall', fiscal_year: period || null, title: `Earnings call ${period}`.trim() }
  return { doc_type: 'other', fiscal_year: null, title: base.replace(/[_-]+/g, ' ') }
}

const clean = (t) => t.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()

function chunkPage(text, page) {
  const out = []
  for (let start = 0; start < text.length; start += CHUNK_CHARS - OVERLAP_CHARS) {
    // End on a sentence or line break when possible, so passages read cleanly.
    let end = Math.min(start + CHUNK_CHARS, text.length)
    if (end < text.length) {
      const cut = Math.max(text.lastIndexOf('. ', end), text.lastIndexOf('\n', end))
      if (cut > start + CHUNK_CHARS * 0.6) end = cut + 1
    }
    out.push({ page, content: text.slice(start, end).trim() })
    if (end >= text.length) break
    start = end - (CHUNK_CHARS - OVERLAP_CHARS)
  }
  return out
}

// Find the consolidated profit-and-loss statement and balance sheet (each with the
// page after it, where statements usually continue), for the extraction step.
// Reports contain both standalone and consolidated versions, plus many notes that
// mention the statements, so each statement is located by its own title.
function statementPages(pages) {
  const best = (titleRe, mustHave) => {
    let top = null
    pages.forEach((text, i) => {
      const t = text.toLowerCase()
      const at = t.search(titleRe)
      if (at < 0 || !mustHave.test(t)) return
      const digits = (t.match(/\d/g) || []).length / Math.max(t.length, 1)
      if (digits < 0.1) return // statements are dense with numbers; narrative pages are not
      let s = digits * 20
      if (/consolidated/.test(t)) s += 6
      if (/standalone/.test(t.slice(0, 600))) s -= 4
      if (at < 600) s += 5 // the title sits at the top of a statement page, not deep in a note
      if (!top || s > top.s) top = { i, s }
    })
    return top ? [top.i, top.i + 1].filter((i) => i < pages.length) : []
  }
  const pl = best(/statement of profit and loss|profit and loss account/, /earnings per (equity )?share|profit for the (year|period)|net profit/)
  const bs = best(/balance sheet/, /total (equity|assets)|capital and liabilities|equity and liabilities/)
  const idx = [...new Set([...pl, ...bs])].sort((a, b) => a - b)
  return idx.map((i) => ({ page: i + 1, text: pages[i] }))
}

async function extractFinancials(company, pages) {
  const picked = statementPages(pages)
  if (!picked.length) return console.log('    ! no financial statement pages found')
  const prompt = `Company: ${company.name}${company.is_bank ? ' (a bank)' : ''}.\n\n` +
    picked.map((p) => `--- page ${p.page} ---\n${p.text.slice(0, 7000)}`).join('\n\n')
  console.log(`    reading statements on pages ${picked.map((p) => p.page).join(', ')}`)
  const r = await generateJson({ tier: 'writer', system: EXTRACT_SYSTEM, prompt, schema: EXTRACT_SCHEMA, maxOutputTokens: 4096, thinking: 'medium' })
  totalCostInr += r.costInr
  const rows = (r.data.years || [])
    .filter((y) => /^FY\d{4}$/.test(y.fiscal_year))
    .map((y) => ({
      ticker: company.ticker,
      fiscal_year: y.fiscal_year,
      revenue: y.revenue ?? null,
      net_profit: y.net_profit ?? null,
      total_equity: y.total_equity ?? null,
      total_borrowings: y.total_borrowings ?? null,
      total_assets: y.total_assets ?? null,
      eps: y.eps ?? null,
      source_page: y.source_page ?? null,
      verified: false,
      updated_at: new Date().toISOString(),
    }))
  if (!rows.length) return console.log('    ! extraction returned no usable years')
  await db.upsert('financials', rows, 'ticker,fiscal_year')
  for (const y of rows) console.log(`    financials ${y.fiscal_year}: revenue ${y.revenue}, net profit ${y.net_profit}, equity ${y.total_equity}, EPS ${y.eps} (${r.data.statement_basis}, unverified)`)
}

async function ingestFile(company, file) {
  const fileName = path.basename(file)
  const meta = describe(fileName)
  const [existing] = await db.select('documents', `ticker=eq.${company.ticker}&file_name=eq.${encodeURIComponent(fileName)}`)
  if (existing && !force) {
    const [hasChunk] = await db.select('chunks', `select=id&document_id=eq.${existing.id}&limit=1`)
    if (hasChunk) return console.log(`  - ${fileName}: already ingested (use --force to redo)`)
  }
  // Clears a previous run that was interrupted before its passages were stored.
  if (existing) await db.remove('documents', `id=eq.${existing.id}`)

  const pdf = await getDocumentProxy(new Uint8Array(await readFile(file)))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = text.map(clean)
  const chunks = pages.flatMap((t, i) => (t.length >= MIN_PAGE_CHARS ? chunkPage(t, i + 1) : []))
  console.log(`  - ${fileName}: ${totalPages} pages -> ${chunks.length} passages`)
  if (!chunks.length) return console.log('    ! no text found (scanned PDF?) - skipped')

  // Prefix each passage with its source so the embedding knows the context.
  const { vectors, inputTokens, costInr } = await embed(
    chunks.map((c) => `${company.name} - ${meta.title} - page ${c.page}\n${c.content}`),
    'passage',
  )
  totalEmbedTokens += inputTokens
  totalCostInr += costInr

  // Only record the document once its embeddings exist, so a failed run leaves nothing half-done.
  const [doc] = await db.insert('documents', [{ ticker: company.ticker, file_name: fileName, page_count: totalPages, ...meta }])

  const rows = chunks.map((c, i) => ({
    document_id: doc.id,
    ticker: company.ticker,
    page: c.page,
    content: c.content,
    embedding: `[${vectors[i].join(',')}]`,
  }))
  for (let i = 0; i < rows.length; i += 200) await db.insert('chunks', rows.slice(i, i + 200), { returning: false })
  console.log(`    stored ${rows.length} passages (~${inputTokens.toLocaleString()} tokens embedded locally)`)

  if (meta.doc_type === 'annual_report') await extractFinancials(company, pages)
}

async function main() {
  const companies = JSON.parse(await readFile(path.join(DATA, 'companies.json'), 'utf8'))
  await db.upsert('companies', companies.map(({ ticker, name, sector, is_bank }) => ({ ticker, name, sector, is_bank: !!is_bank })), 'ticker')

  for (const company of companies) {
    if (only.length && !only.includes(company.ticker)) continue
    const dir = path.join(DATA, 'filings', company.ticker)
    const files = (await readdir(dir).catch(() => [])).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()
    if (!files.length) {
      console.log(`${company.ticker}: no PDFs in data/filings/${company.ticker}/ - skipped`)
      continue
    }
    console.log(`${company.ticker} (${company.name})`)
    if (financialsOnly) {
      for (const f of files.filter((f) => describe(f).doc_type === 'annual_report')) {
        try {
          const pdf = await getDocumentProxy(new Uint8Array(await readFile(path.join(dir, f))))
          const { text } = await extractText(pdf, { mergePages: false })
          await extractFinancials(company, text.map(clean))
        } catch (err) {
          console.error(`    ! ${f} failed: ${err.message.split('\n')[0]}`)
        }
      }
      continue
    }
    for (const f of files) {
      try {
        await ingestFile(company, path.join(dir, f))
      } catch (err) {
        console.error(`    ! ${f} failed: ${err.message.split('\n')[0]}`)
        if (err.dailyQuota) {
          console.error('\nStopped: the Gemini daily quota is used up. Enable billing or run again tomorrow; finished files are kept.')
          process.exit(1)
        }
      }
    }
  }
  console.log(`\nDone. Embedded ~${totalEmbedTokens.toLocaleString()} tokens locally (free). Gemini cost for financials extraction: ~Rs ${totalCostInr.toFixed(2)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
