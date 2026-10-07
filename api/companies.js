// GET /api/companies -> companies the analyst covers, with document counts.

import { db } from '../lib/supabase.js'

export default async function handler(req, res) {
  try {
    const [companies, documents] = await Promise.all([
      db.select('companies', 'select=ticker,name,sector,is_bank&order=name.asc'),
      db.select('documents', 'select=ticker,title,doc_type,fiscal_year,page_count'),
    ])
    const list = companies.map((c) => ({ ...c, documents: documents.filter((d) => d.ticker === c.ticker) }))
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 's-maxage=300')
    res.end(JSON.stringify({ companies: list.filter((c) => c.documents.length) }))
  } catch (err) {
    console.error('companies error:', err)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Could not load companies' }))
  }
}
