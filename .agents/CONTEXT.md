# Operational Context and Memory Registry

This file records the cumulative architectural decisions, production incidents, and operational learnings for this repository. AI agents read this file to avoid repeating past mistakes.

---

## 1. Project Summary & Active Capabilities

* **Project Name:** agentic-sdd-framework
* **Specification Mode:** Lite
* **Primary Runtime:** node-24-lts
* **Architecture Style:** clean-architecture
* **Active Capabilities:**
  * No-AI-Slop Linter: Enabled
  * AST Navigator Adapter: ast-grep
  * Internationalization (i18n): Disabled
  * Progressive Web App (PWA): Disabled

---

## 2. Incident & Root-Cause Registry

Whenever a production regression, test flake, or operational issue is resolved, record the incident below. Every incident must produce a verifiable rule in `.agents/AGENTS.md`.

### Template:
```markdown
### [YYYY-MM-DD] Incident: [Short Title]
* **Symptom:** What broke and where was it observed.
* **Root Cause:** The underlying mechanical or architectural flaw.
* **Remediation:** The code change or configuration fix applied.
* **Inviolable Rule Created:** Link to the corresponding rule added to AGENTS.md.
```

---

## 3. Active Technical Debt & Non-Goals

Document known constraints, deferred refactors, and explicit non-goals to prevent agents from attempting unsolicited cleanups.

* [Non-Goal 1]: [Description]
* [Technical Debt 1]: [Description and tracking issue]
