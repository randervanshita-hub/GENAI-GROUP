# Arthavid: research that shows its work

Arthavid is an AI equity research analyst for Indian retail investors. Pick a listed company, ask a question, and Arthavid:

1. **Plans** the research and spots buy/sell or off-topic questions (Gemini 3.1 Flash-Lite)
2. **Reads** the company's annual report and earnings-call transcripts through retrieval over a vector database (RAG: an open-source embedding model, bge-small, run locally + Supabase pgvector)
3. **Uses tools**: a live NSE price feed and a ratio calculator written in code, so no AI model does arithmetic
4. **Writes** a short note where every claim cites a source passage or computed figure (Gemini 3.8 Flash)
5. **Fact-checks** each claim against the exact evidence it cites, and removes unsupported claims while showing you which ones and why (Gemini 3.1 Flash-Lite)

Every run logs tokens, rupee cost and latency per step. See [docs/architecture.md](docs/architecture.md) for the diagram.

> Educational tool only. Arthavid does not make buy/sell/hold recommendations and is not SEBI-registered.

---

## Run it yourself

### 1. Requirements
- Node.js 20 or later
- A free Google AI Studio account (Gemini API key)
- A free Supabase project

### 2. API keys: where to put what
Copy `.env.example` to `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey → Create API key |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API → `service_role` secret key |

No keys are included in this repository. The keys are only used on the server (`api/` and `scripts/`) and never reach the browser.

### 3. Create the database
In Supabase, open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. This turns on the `vector` extension and creates the tables and the search function.

### 4. Load the filings
Put PDFs in `data/filings/<TICKER>/` using these names:
- `AR_FY2026.pdf`: annual report for the year ending March 2026
- `CONCALL_Q1FY27.pdf`: earnings-call transcript

Then:
```bash
npm install
npm run ingest
```
This splits each PDF into passages, embeds them, stores them in Supabase, and extracts headline financials from annual reports. Check the extracted figures in the Supabase `financials` table, then set `verified` to true.

### 5. Start the app
```bash
npm run dev
```
Open http://localhost:3000

### 6. Evaluate and measure cost
```bash
npm run eval
npm run cost-report
```
`eval` runs the test questions in `evals/questions.json` and appends scores to `docs/eval-summary.md`. `cost-report` writes `docs/cost-report.md` with per-session cost and a 10,000-user projection, from real logged runs.

## Deploy (Vercel)
Import the GitHub repo in Vercel, add the same three environment variables under **Settings → Environment Variables**, and deploy. No build step is needed: `public/` is served as-is and `api/*.js` become serverless functions.

## Project layout
```
api/            serverless endpoints (companies, analyze)
lib/            pipeline, prompts, tools, Gemini and Supabase clients, cost table
public/         front end (HTML, CSS, JS, no build step)
scripts/        ingest, eval, cost-report
supabase/       database schema
data/           company list and filings PDFs
evals/          test questions and results
docs/           architecture, prompt log, failure log, eval and cost reports
```
