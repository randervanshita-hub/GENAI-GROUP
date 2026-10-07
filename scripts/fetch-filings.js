// Download the filings listed in data/filings/manifest.json from NSE's public
// archive into data/filings/<TICKER>/. Skips files already present.
//
//   npm run fetch-filings

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const manifest = JSON.parse(await readFile('data/filings/manifest.json', 'utf8'))

for (const f of manifest) {
  const dest = path.join('data/filings', f.ticker, f.file)
  if (await stat(dest).catch(() => null)) {
    console.log(`${f.ticker.padEnd(11)} ${f.file}: already downloaded`)
    continue
  }
  const res = await fetch(f.url, { headers: { 'User-Agent': UA, Referer: 'https://www.nseindia.com/' } })
  if (!res.ok) {
    console.log(`${f.ticker.padEnd(11)} ${f.file}: FAILED (HTTP ${res.status}) ${f.url}`)
    continue
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const expected = Number(res.headers.get('content-length'))
  if (expected && buf.length !== expected) {
    console.log(`${f.ticker.padEnd(11)} ${f.file}: FAILED (incomplete download, ${buf.length} of ${expected} bytes), run again`)
    continue
  }
  if (buf.subarray(0, 4).toString() !== '%PDF') {
    console.log(`${f.ticker.padEnd(11)} ${f.file}: FAILED (not a PDF)`)
    continue
  }
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, buf)
  console.log(`${f.ticker.padEnd(11)} ${f.file}: ${(buf.length / 1048576).toFixed(1)} MB`)
}
