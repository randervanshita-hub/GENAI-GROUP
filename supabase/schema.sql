-- Arthavid database schema.
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: every statement is idempotent.

-- pgvector lets Postgres store embeddings (lists of 768 numbers that capture the
-- meaning of a passage) and find the passages closest in meaning to a question.
create extension if not exists vector;

-- Companies the analyst covers.
create table if not exists companies (
  ticker      text primary key,          -- NSE symbol, e.g. HDFCBANK
  name        text not null,
  sector      text not null,
  is_bank     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- One row per source document (annual report, earnings-call transcript).
create table if not exists documents (
  id          bigserial primary key,
  ticker      text not null references companies(ticker) on delete cascade,
  title       text not null,
  doc_type    text not null,              -- annual_report | concall | other
  fiscal_year text,                       -- e.g. FY2026
  file_name   text not null,
  page_count  int,
  created_at  timestamptz not null default now(),
  unique (ticker, file_name)
);

-- Passages from those documents, with their embeddings.
create table if not exists chunks (
  id          bigserial primary key,
  document_id bigint not null references documents(id) on delete cascade,
  ticker      text not null,
  page        int not null,
  content     text not null,
  embedding   vector(768) not null
);
create index if not exists chunks_ticker_idx on chunks (ticker);
create index if not exists chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);

-- Headline financials extracted from annual reports at ingestion time (Rs crore).
-- The calculator tool computes ratios from these, so the LLM never does arithmetic.
create table if not exists financials (
  ticker            text not null references companies(ticker) on delete cascade,
  fiscal_year       text not null,
  revenue           numeric,             -- revenue from operations (banks: total income)
  net_profit        numeric,             -- profit after tax attributable to owners
  total_equity      numeric,
  total_borrowings  numeric,
  total_assets      numeric,
  eps               numeric,             -- basic EPS in Rs
  source_page       int,
  verified          boolean not null default false,  -- flip to true after a human checks it
  updated_at        timestamptz not null default now(),
  primary key (ticker, fiscal_year)
);

-- Every analysis run: the input, the output, and per-step token usage for cost reporting.
create table if not exists runs (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  visitor_id      text,
  ticker          text not null,
  question        text not null,
  question_key    text not null,         -- normalised question, used for caching
  prompt_version  text not null,
  memo            jsonb,
  steps           jsonb,                 -- [{step, model, input_tokens, output_tokens, cost_inr, ms}]
  input_tokens    int not null default 0,
  output_tokens   int not null default 0,
  cost_inr        numeric not null default 0,
  latency_ms      int,
  claims_total    int,
  claims_supported int,
  cached          boolean not null default false,
  source          text not null default 'web'  -- web | eval
);
create index if not exists runs_cache_idx on runs (ticker, question_key, created_at desc);
create index if not exists runs_visitor_idx on runs (visitor_id, created_at desc);

-- Retrieval: the k passages for one company closest in meaning to the query.
create or replace function match_chunks(query_embedding vector(768), p_ticker text, match_count int default 6)
returns table (id bigint, document_id bigint, page int, content text, similarity float)
language sql stable as $$
  select c.id, c.document_id, c.page, c.content, 1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  where c.ticker = p_ticker
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Lock everything down: no public access. Only the server (service role key) reads or writes.
alter table companies  enable row level security;
alter table documents  enable row level security;
alter table chunks     enable row level security;
alter table financials enable row level security;
alter table runs       enable row level security;
