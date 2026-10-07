# What failed, and what we changed

An honest log for the presentation. Add an entry every time something breaks or surprises us.

| Date | What happened | Why | What we changed |
|---|---|---|---|
| 2026-10-08 | `gemini-3.8-flash` and `gemini-3.5-flash` returned 503 "high demand" during setup | Popular models get overloaded at peak times | Every step now has a fallback chain of models and one retry, and the trace shows which model actually answered |
| 2026-10-08 | `gemini-2.5-flash` (used in our earlier project) refused requests: "no longer available to new users" | Google retired the model for new keys | Switched to the 3.x family; model names are kept in one config list |
| 2026-10-08 | Thinking tokens made a 5-token reply cost 230 tokens | Newer Gemini models "think" by default, and thinking is billed as output | Set thinking to "low" for every step and count thinking tokens in our cost logs |
