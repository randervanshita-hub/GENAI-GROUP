// Tiny Supabase REST (PostgREST) client. Server-side only: uses the service
// role key, which must never reach the browser.

function env() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY are not set')
  return { url, key }
}

async function request(path, { method = 'GET', body, prefer } = {}) {
  const { url, key } = env()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]} -> ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

export const db = {
  select: (table, query = '') => request(`${table}?${query}`),
  insert: (table, rows, { returning = true } = {}) =>
    request(table, { method: 'POST', body: rows, prefer: returning ? 'return=representation' : 'return=minimal' }),
  upsert: (table, rows, onConflict) =>
    request(`${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      body: rows,
      prefer: 'resolution=merge-duplicates,return=representation',
    }),
  remove: (table, query) => request(`${table}?${query}`, { method: 'DELETE' }),
  rpc: (fn, args) => request(`rpc/${fn}`, { method: 'POST', body: args }),
}
