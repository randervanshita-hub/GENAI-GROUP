// Write docs/financials-to-verify.md: every AI-extracted figure with its source
// page, as a checklist for a human to verify against the annual report.
//
//   npm run financials-report

import { writeFile } from 'node:fs/promises'
import { db } from '../lib/supabase.js'

const rows = await db.select('financials', 'select=*&order=ticker,fiscal_year.desc')
const companies = await db.select('companies', 'select=ticker,name')
const name = Object.fromEntries(companies.map((c) => [c.ticker, c.name]))
const fmt = (x) => (x == null ? '**missing**' : Number(x).toLocaleString('en-IN'))

let md = `# Financial figures to verify

These were read from each annual report by AI (consolidated statements, Rs crore; EPS in Rs). The calculator uses them for ratios, so a human should check each one against the page shown, then set \`verified\` to true in the Supabase \`financials\` table (Table Editor). About 10 minutes for the whole team.

Open \`data/filings/<TICKER>/AR_FY2026.pdf\`, go to the page, and tick the box if the figure matches.

| Company | Year | Revenue | Net profit (owners) | Equity | EPS (Rs) | Page | Verified |
|---|---|---|---|---|---|---|---|
`
for (const r of rows)
  md += `| ${name[r.ticker]} | ${r.fiscal_year} | ${fmt(r.revenue)} | ${fmt(r.net_profit)} | ${fmt(r.total_equity)} | ${fmt(r.eps)} | ${r.source_page ?? '-'} | ${r.verified ? 'yes' : '[ ]'} |\n`
md += `
Notes: for banks, revenue is total income (interest earned plus other income). Where a report lists revenue only in parts (Asian Paints), revenue is total income minus other income, computed in code. Net profit is the share attributable to the company's owners, excluding non-controlling interests.
`
await writeFile('docs/financials-to-verify.md', md)
console.log(`Wrote docs/financials-to-verify.md (${rows.length} rows, ${rows.filter((r) => r.verified).length} verified)`)
