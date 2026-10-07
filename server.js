// Local server: serves public/ and routes /api/* to the same handlers Vercel runs.
// Start with `npm run dev`, then open http://localhost:3000

import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }

const routes = {
  '/api/companies': () => import('./api/companies.js'),
  '/api/analyze': () => import('./api/analyze.js'),
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (routes[url.pathname]) {
      const { default: handler } = await routes[url.pathname]()
      return await handler(req, res)
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const file = path.join(root, 'public', path.normalize(rel))
    if (!file.startsWith(path.join(root, 'public'))) throw Object.assign(new Error('forbidden'), { code: 'ENOENT' })
    const data = await readFile(file)
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream')
    res.end(data)
  } catch (err) {
    if (!res.headersSent) res.statusCode = err.code === 'ENOENT' ? 404 : 500
    if (err.code !== 'ENOENT') console.error(err)
    res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error')
  }
}).listen(PORT, () => console.log(`Arthavid running at http://localhost:${PORT}`))
