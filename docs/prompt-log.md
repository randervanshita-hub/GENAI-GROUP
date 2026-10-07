# Prompt change log

Each version is evaluated with `npm run eval`; scores are in [eval-summary.md](eval-summary.md).

## v1 (2026-10-08): first version
- Planner classifies scope (ok / advice_request / off_topic) and writes 3-5 search queries phrased like filings.
- Writer must cite evidence ids on every claim, quote numbers only from evidence, and never give buy/sell/hold calls.
- Fact-checker judges each claim only against its own cited evidence: supported / partial / unsupported.

## v1 tweak (2026-10-08): advice questions
- Problem: for "Should I buy?", the writer opened with "Arthavid does not make buy or sell calls" as a claim. The fact-checker marked it only partly supported (no filing says that), which lowered the score for a correct behaviour.
- Change: the writer is told not to restate the policy; the page shows it as a notice instead.
