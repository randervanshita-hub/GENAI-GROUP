# What failed, and what we changed

An honest log for the presentation. Add an entry every time something breaks or surprises us.

| Date | What happened | Why | What we changed |
|---|---|---|---|
| 2026-10-08 | `gemini-3.8-flash` and `gemini-3.5-flash` returned 503 "high demand" during setup | Popular models get overloaded at peak times | Every step now has a fallback chain of models and one retry, and the trace shows which model actually answered |
| 2026-10-08 | `gemini-2.5-flash` (used in our earlier project) refused requests: "no longer available to new users" | Google retired the model for new keys | Switched to the 3.x family; model names are kept in one config list |
| 2026-10-08 | Thinking tokens made a 5-token reply cost 230 tokens | Newer Gemini models "think" by default, and thinking is billed as output | Set thinking to "low" for every step and count thinking tokens in our cost logs |
| 2026-10-08 | Bharti Airtel's annual report failed to parse ("Invalid Root reference") | The download was cut off (21.4 of 21.7 MB) | Re-downloaded; the fetch script now compares the size with what the server announced and flags incomplete files |
| 2026-10-08 | Maruti's "transcript" filing on NSE was a one-page cover letter pointing to its website | Some companies file only a link with the exchange | Dropped it; Maruti is covered by its annual report only |
| 2026-10-08 | Loading stopped after one company: HDFC and ICICI annual reports stored 0 passages | Gemini's free tier allows 1,000 embedding requests a day, and each passage counts as one; TCS alone used about 900 | Billing needed to continue (about Rs 60 to embed all 12 companies). Ingestion now stops cleanly on a daily quota and never leaves a document recorded without its passages |
| 2026-10-08 | A valuation question took 110 s; the writer model hung for 86 s before falling back | Overloaded model with no time limit on the call | Every AI call now has a 25 s limit before the next model in the chain takes over; retries are logged per step |
| 2026-10-08 | The advice filter removed "Investors should track how fast AI deals turn into revenue" | The pattern matched "investors should" on its own | Narrowed it to actual trading verbs (buy, sell, hold, accumulate, exit, book profits); tested on 9 example sentences |
| 2026-10-08 | After switching to local embeddings, four companies appeared "loaded" with no passages | An earlier loading run was stopped from the terminal, but its Node process kept running with the old code, creating empty document rows | Killed the stray process; the loader now treats documents without passages as unfinished and redoes them |
| 2026-10-08 | First live question on Vercel cost Rs 2.56 instead of about Rs 0.85 | gemini-3.8-flash was overloaded, so the writer fell back to gemini-3.5-flash, which costs twice as much per token | Kept the fallback (an answer beats an error in a live demo) and log which model actually answered, so the cost report reflects it |
| 2026-10-08 | Infosys revenue, profit and EPS came back empty | The page-picker scored note pages and standalone statements above the consolidated profit-and-loss page | The picker now locates each statement by its title, prefers consolidated, and adds the continuation page; `--financials-only` redoes just this step. Infosys now matches its published results (revenue Rs 1,78,650 cr, profit Rs 29,474 cr) |
