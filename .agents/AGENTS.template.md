# Agent Constitution and Behavioral Guidelines

This document establishes the non-negotiable operating rules for AI coding agents working in this repository. Every agent must read and adhere to these directives before executing tasks.

---

## 1. Discovery First (No Premature Assumptions)
* **Rule:** Before recommending architectures, selecting frameworks, or generating code on a new initiative, the agent must execute the 4-Pillar Discovery Interview (Scale/Concurrency, Hardware/Deployment, Workload/Compute, Modularity).
* **Why this rule exists:**
  > [Document the incident or rationale here. For example: An agent previously recommended a heavy full-stack framework for a lightweight streaming utility, introducing unnecessary runtime bloat.]

---

## 2. Evidence-Driven Debugging & Diagnostics
* **Rule:** Never guess root causes or apply speculative patches. Inspect log files, inspect command output, and run diagnostics before altering code.
* **Why this rule exists:**
  > [Document the incident or rationale here. For example: Speculative patches often introduce regression cascades that obscure the original defect.]

---

## 3. Mandatory Verification Before Certification
* **Rule:** A task or phase is not complete until its explicit verification command exits with code 0. Reading code visually is never a substitute for running the code.
* **Why this rule exists:**
  > [Document the incident or rationale here. For example: Clean syntax does not guarantee functional runtime behavior or integration success.]

---

## 4. Closed-Network Testing Isolation
* **Rule:** Automated test suites must never contact external internet hosts. All external integrations must be mocked or gated on environment variables. Loopback testing is permitted for local servers.
* **Why this rule exists:**
  > [Document the incident or rationale here. For example: Test suites that hit third-party APIs can cause hard bounces, rate limits, and unexpected billing exposure.]

---

## 5. Zero-Trust Secrets Management
* **Rule:** Agents must never request API keys or credentials in chat prompts. Secrets must be read directly from the Tier 3 Vault (`~/secrets/<app>/.vault`) or environment variables. Never commit secrets to Git.
* **Why this rule exists:**
  > [Document the incident or rationale here. For example: Chat logs and git histories are permanently recorded; leaking credentials requires immediate key revocation.]

---

## 6. Scope Bounding & Atomic Progression
* **Rule:** Execute one task at a time in strict sequence. Do not refactor unrelated files or perform out-of-scope cleanups without explicit Auditor authorization.
* **Why this rule exists:**
  > [Document the incident or rationale here. For example: Unbounded edits make regression tracing difficult and invalidate concurrent session handoffs.]

---

## 7. Factual Technical Copy (No AI Slop)
* **Rule:** All documentation, user-facing copy, and commit messages must be factual, concise, and dense. Banned: empty buzzwords, binary contrast structures, throat-clearing openers, colon reveals, and em-dash rhythm crutches.
* **Why this rule exists:**
  > [Document the incident or rationale here. For example: Promotional puffery and marketing contrasts obscure technical reality and degrade documentation clarity.]

---

## 8. Author Attribution & Integrity
* **Rule:** Never attach `Co-Authored-By:` trailers crediting AI assistants to Git commits. The repository owner is the sole author.
* **Why this rule exists:**
  > [Document the incident or rationale here. For example: Project contributors retain 100% ownership and commit graph clarity without AI tooling noise.]
