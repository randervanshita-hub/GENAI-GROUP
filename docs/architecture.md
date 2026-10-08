# Architecture

```mermaid
flowchart LR
  U[User: company + question] --> P

  subgraph Pipeline [api/analyze: one request, streamed step by step]
    P[1. Plan<br/>gemini-3.1-flash-lite<br/>scope check + search queries]
    P -->|off-topic| X[Polite refusal]
    P --> R[2. Retrieve<br/>bge-small, open model run locally<br/>+ pgvector search]
    P --> T[3. Tools<br/>Yahoo Finance price feed<br/>+ ratio calculator in code]
    R --> D[4. Draft<br/>gemini-3.1-flash-lite<br/>every claim cites S# or T#]
    T --> D
    D --> C[5. Fact-check<br/>gemini-3.1-flash-lite<br/>claim vs its own source]
  end

  C --> O[Note: verified claims, removed claims, sources, cost]
  C --> L[(runs table:<br/>tokens, ₹, latency per step)]

  subgraph Offline [scripts/ingest: once per filing]
    F[Annual reports +<br/>earnings-call PDFs] --> K[Split into passages<br/>+ embed locally with bge-small]
    K --> V[(Supabase pgvector)]
    F --> E[Extract financials<br/>gemini-3.1-flash-lite] --> FIN[(financials table)]
  end
  V -.-> R
  FIN -.-> T
  L -.-> CACHE[24 h answer cache] -.-> P
```

**Why these models (hybrid of tiers, one provider):**
- A proprietary API (Gemini) instead of an open model: no GPU to host, strong at long financial documents, and a free tier for development.
- One fast, cheap model (Gemini 3.1 Flash-Lite) does planning, writing and fact-checking. We planned to write with the stronger gemini-3.8-flash, but the free tier allows it only 20 requests a day; Flash-Lite still reached 93% fully supported claims in our 17-question evaluation, at roughly a third of the price. With billing, the stronger writer is one setting away (WRITER_MODELS).
- Each tier has a fallback chain (gemini-3.5-flash-lite as backup), because popular models return 503 errors at peak times. Every AI call has a hard 25-second deadline.
- Embeddings use an **open model run locally** (BAAI bge-small-en-v1.5, 384 dimensions, via ONNX Runtime). It is free with no quota, which matters because the free Gemini tier allows only 1,000 embedding requests a day and our 12 companies need about 11,000 passages embedded. Search quality is slightly lower than Gemini's embedding model, but the fact-checker catches claims built on weak passages.
