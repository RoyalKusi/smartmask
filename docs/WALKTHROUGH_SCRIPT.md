# SmartMask Console: 5-minute walkthrough script

Target: about 700 spoken words at a calm pace (~140 wpm). **[ACTION]** lines are what to do on screen; the quoted text is what to say.
Before recording: `npm run build && npm run preview`, open `http://localhost:4173/#/overview`, light theme, 1440×900, browser zoom 100%.

---

## 0:00 – Intro (20 s)
**[Overview page on screen, don't touch anything]**

"This is SmartMask Console, a demonstration of our dynamic data masking engine for financial data, built by team QBADS for Smart India Hackathon 2026. Everything you see is synthetic data for a fictional bank, and the engine is a simulation, which the badge at the bottom right says at all times. Let me walk through all nine views."

## 0:20 – Overview (30 s)
**[Point at the four KPI cards, then the chart, then click the PII_HIGH legend entry. It opens Discovery. Click Overview in the left menu to come back.]**

"The Overview shows 192 columns discovered across PostgreSQL, SQLite and MySQL, 45 enforced, about 660 masked queries in the last day, and a simulated P99 overhead of around four milliseconds against a five millisecond ceiling. The chart splits query volume by role, and every chart has a view-as-table option for accessibility. Clicking a tag jumps straight to Discovery, filtered."

## 0:50 – Discovery (40 s)
**[Click Discovery. Filter State to REVIEW. Press Scan.]**

"Discovery scores every column as 0.30 times name, plus 0.55 times pattern, plus 0.15 times entropy. At 0.70 or above a column is ENFORCED. Between 0.40 and 0.70 it is REVIEW, and is masked fail-closed until a person decides. A machine-learning classifier can promote a column at 0.85, but it can never clear one. Watch the scan run through five stages and fill the table. Note order_ref, a sixteen-digit number that is not a card, sitting in review."

## 1:30 – Review Queue (35 s)
**[Click Review Queue. Click Approve on legacy_cards.c1. Then Clear… on order_ref, type a short reason, show the Clear button stays disabled, then a full reason.]**

"Each review card shows value shapes, never raw values, plus the classifier output and an AI suggestion. The AI only recommends. Approving enforces the tag, with an Undo toast. Clearing is destructive, so it demands a justification of at least twelve characters. Both decisions update the catalog, the Overview counters and the audit trail."

## 2:05 – Policy Studio (40 s)
**[Click Policy Studio. Type invalid YAML at the end. Revert. Click "Let support see full card numbers", then Discard. Click "Redact balances for support", then Approve and publish.]**

"Policy is YAML. Invalid YAML disables Save and flags the exact line. The matrix on the right shows what every role sees per tag. The Copilot turns plain language into a YAML diff. Asking to show support full card numbers is refused by a guardrail. Asking to redact balances for support passes validation, shows a golden-query diff, and on approval publishes version eight, which invalidates the plan cache."

## 2:45 – Query Workbench (60 s)
**[Click Query Workbench. Run the canonical example as Admin. Click Support, then Analyst. Pick "Literal probe on a tagged column", run as Support.]**

"This is the heart of it. The query runs through parse, validate, rewrite, execute, mask and audit, with overhead measured against a four millisecond budget. As Admin I see the real card and balance. Switching to Support re-masks the same result without re-running: the card keeps its first and last four digits and the balance becomes a bucket. As Analyst I get a deterministic token and redacted balance, and equal inputs give equal tokens, so joins still work. The bottom-middle pane is the base table, labelled evaluator only. Now a literal probe on a card column as Support is rejected with SM-PRED-001, because it would let someone guess raw values."

## 3:45 – Verification and Audit Trail (45 s)
**[Click Verification. Click Run verification batch. Click Audit Trail. Click Verify chain, then Tamper test…, confirm, Verify chain again.]**

"Verification hashes every base table before and after each query batch, proving the raw data never changes. Every query also writes an audit event whose hash commits to the previous event. Verify chain passes on all eight thousand events. If I simulate tampering with one event and verify again, the chain breaks at exactly that row and everything after it is marked untrusted."

## 4:30 – Performance and Anomalies (25 s)
**[Click Performance, point at gauge and waterfall. Click Anomalies, select the t.chikwanha alert, point at the radar.]**

"Performance shows the stage waterfall, percentiles and cache hit ratio. All of these are simulated figures, not benchmarks. Anomalies uses an Isolation Forest to flag three incidents, for example an analyst who made forty denied card probes and then swept eleven sensitive columns. It raises alerts only. It never changes a masking decision."

## 4:55 – Close (5 s)
**[Toggle dark theme with the moon button.]**

"Dark mode, full keyboard support, and 79 automated tests. Thank you."

---

### Tips
- Use `?fast=1` at the end of the URL if the simulated latency feels slow on camera.
- Refresh the page to reset all state (tamper test, policy version, decisions) before each take.
- If you run long, cut the Verification batch run and the dark mode close.
