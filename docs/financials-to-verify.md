# Financial figures to verify

These were read from each annual report by AI (consolidated statements, Rs crore; EPS in Rs). The calculator uses them for ratios, so a human should check each one against the page shown, then set `verified` to true in the Supabase `financials` table (Table Editor). About 10 minutes for the whole team.

Open `data/filings/<TICKER>/AR_FY2026.pdf`, go to the page, and tick the box if the figure matches.

| Company | Year | Revenue | Net profit (owners) | Equity | EPS (Rs) | Page | Verified |
|---|---|---|---|---|---|---|---|
| Asian Paints | FY2026 | 35,583.54 | 4,325.35 | 21,371.59 | 45.12 | 234 | [ ] |
| Asian Paints | FY2025 | 33,905.62 | 3,667.23 | 19,399.81 | 38.25 | 234 | [ ] |
| Bharti Airtel | FY2026 | 2,10,972.8 | 26,695.2 | 1,49,056.6 | 45.96 | 216 | [ ] |
| Bharti Airtel | FY2025 | 1,72,985.2 | 33,556.1 | 1,13,671.9 | 58 | 216 | [ ] |
| HDFC Bank | FY2026 | 4,95,462.81 | 76,025.97 | 5,81,514.36 | 49.5 | 497 | [ ] |
| HDFC Bank | FY2025 | 4,70,915.93 | 70,792.25 | 5,17,984.2 | 46.41 | 497 | [ ] |
| Hindustan Unilever | FY2026 | 64,468 | 15,040 | 49,008 | 64.01 | 186 | [ ] |
| Hindustan Unilever | FY2025 | 61,328 | 10,649 | 49,609 | 45.32 | 186 | [ ] |
| ICICI Bank | FY2026 | 3,12,118.359 | 54,207.703 | 3,60,378.348 | 75.89 | 374 | [ ] |
| ICICI Bank | FY2025 | 2,94,586.934 | 51,029.196 | 3,11,836.063 | 72.41 | 374 | [ ] |
| Infosys | FY2026 | 1,78,650 | 29,440 | 93,297 | 71.58 | 288 | [ ] |
| Infosys | FY2025 | 1,62,990 | 26,713 | 96,203 | 64.5 | 288 | [ ] |
| ITC | FY2026 | 89,913.33 | 20,689.47 | 72,873.02 | 16.52 | 255 | [ ] |
| ITC | FY2025 | 81,612.78 | 34,746.63 | 70,397.94 | 27.79 | 255 | [ ] |
| Maruti Suzuki India | FY2026 | 1,83,316 | 14,679.5 | 1,07,156.3 | 466.9 | 235 | [ ] |
| Maruti Suzuki India | FY2025 | 1,52,913 | 14,500.2 | 96,239.9 | 461.2 | 235 | [ ] |
| Reliance Industries | FY2026 | 10,75,675 | 80,775 | 10,85,866 | 59.69 | 140 | [ ] |
| Reliance Industries | FY2025 | 9,80,136 | 69,648 | 10,09,626 | 51.47 | 140 | [ ] |
| Sun Pharmaceutical Industries | FY2026 | 58,462.04 | 11,479.42 | 83,879.74 | 47.8 | 243 | [ ] |
| Sun Pharmaceutical Industries | FY2025 | 52,578.44 | 10,929.04 | 72,485.95 | 45.6 | 243 | [ ] |
| Tata Consultancy Services | FY2026 | 2,67,021 | 49,210 | 1,08,478 | 136.01 | 168 | [ ] |
| Tata Consultancy Services | FY2025 | 2,55,324 | 48,553 | 95,771 | 134.19 | 168 | [ ] |
| Titan Company | FY2026 | 87,584 | 5,073 | 15,703 | 57.19 | 376 | [ ] |
| Titan Company | FY2025 | 60,456 | 3,337 | 11,624 | 37.62 | 376 | [ ] |

Notes: for banks, revenue is total income (interest earned plus other income). Where a report lists revenue only in parts (Asian Paints), revenue is total income minus other income, computed in code. Net profit is the share attributable to the company's owners, excluding non-controlling interests.
