# Architecture

```mermaid
flowchart LR
  U[User: company + question] --> P

  subgraph Pipeline [api/analyze: one request, streamed step by step]
    P[1. Plan<br/>gemini-3.1-flash-lite<br/>scope check + search queries]
    P -->|off-topic| X[Polite refusal]
    P --> R[2. Retrieve<br/>gemini-embedding-2<br/>+ pgvector search]
    P --> T[3. Tools<br/>Yahoo Finance price feed<br/>+ ratio calculator in code]
    R --> D[4. Draft<br/>gemini-3.8-flash<br/>every claim cites S# or T#]
    T --> D
    D --> C[5. Fact-check<br/>gemini-3.1-flash-lite<br/>claim vs its own source]
  end

  C --> O[Note: verified claims, removed claims, sources, cost]
  C --> L[(runs table:<br/>tokens, ₹, latency per step)]

  subgraph Offline [scripts/ingest: once per filing]
    F[Annual reports +<br/>earnings-call PDFs] --> K[Split into passages<br/>+ embed]
    K --> V[(Supabase pgvector)]
    F --> E[Extract financials<br/>gemini-3.8-flash] --> FIN[(financials table)]
  end
  V -.-> R
  FIN -.-> T
  L -.-> CACHE[24 h answer cache] -.-> P
```

**Why these models (hybrid of tiers, one provider):**
- A proprietary API (Gemini) instead of an open model: no GPU to host, strong at long financial documents, and a free tier for development.
- The cheapest model handles planning and fact-checking, which are short, structured tasks. The stronger model is used only for writing, where quality shows.
- Each tier has a fallback chain, because the most popular models return 503 errors at peak times.
