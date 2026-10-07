# Prompt change log

Each version is evaluated with `npm run eval`; scores are in [eval-summary.md](eval-summary.md).

## v1 (2026-10-08): first version
- Planner classifies scope (ok / advice_request / off_topic) and writes 3-5 search queries phrased like filings.
- Writer must cite evidence ids on every claim, quote numbers only from evidence, and never give buy/sell/hold calls.
- Fact-checker judges each claim only against its own cited evidence: supported / partial / unsupported.
