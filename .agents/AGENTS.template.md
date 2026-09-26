# Agent Constitution and Behavioral Guidelines

This document establishes the non-negotiable operating rules for AI coding agents working in this repository. Every agent must read and adhere to these directives before executing tasks.

---

<!-- sdd:rule id="discovery-first" tier="moderate" -->
## 1. Discovery First (No Premature Assumptions)
* **Rule:** Before recommending architectures, selecting frameworks, or generating code on a new initiative, the agent must execute the 4-Pillar Discovery Interview (Scale/Concurrency, Hardware/Deployment, Workload/Compute, Modularity).
* **Why this rule exists:**
  > A stack or architecture chosen before the actual scale, deployment target, and workload are known tends to be either over-built or wrong for the job; a few minutes of discovery costs less than unwinding that choice later.

---

<!-- sdd:rule id="evidence-driven-debugging" tier="moderate" -->
## 2. Evidence-Driven Debugging & Diagnostics
* **Rule:** Never guess root causes or apply speculative patches. Inspect log files, inspect command output, and run diagnostics before altering code.
* **Why this rule exists:**
  > A fix aimed at a guessed cause, instead of the one diagnostics actually show, risks patching a symptom while the real defect -- and a regression alongside it -- stays hidden.

---

<!-- sdd:rule id="mandatory-verification" tier="critical" -->
## 3. Mandatory Verification Before Certification
* **Rule:** A task or phase is not complete until its explicit verification command exits with code 0. Reading code visually is never a substitute for running the code.
* **Why this rule exists:**
  > Clean-looking code is not proof of working code. A visual review cannot catch a broken runtime path, a failing integration, or a regression an agent introduced while editing; running the actual command is the only evidence this framework accepts, which is why `sdd-verify` exists.

---

<!-- sdd:rule id="closed-network-testing" tier="moderate" -->
## 4. Closed-Network Testing Isolation
* **Rule:** Automated test suites must never contact external internet hosts. All external integrations must be mocked or gated on environment variables. Loopback testing is permitted for local servers.
* **Why this rule exists:**
  > A test suite that reaches a real third-party API is one flaky network call away from a false failure, and one bad run away from a rate limit or a bill nobody asked for.

---

<!-- sdd:rule id="zero-trust-secrets" tier="critical" -->
## 5. Zero-Trust Secrets Management
* **Rule:** Agents must never request API keys or credentials in chat prompts. Secrets must be read directly from the Tier 3 Vault (`~/secrets/<app>/.vault`) or environment variables. Never commit secrets to Git. Tier model: `docs/guides/AGENT_CREDENTIALS.md`.
* **Why this rule exists:**
  > A credential typed into a chat prompt or pasted into a diff is permanently recorded in logs and git history. Treat every prompt and every commit as effectively public, and never put a secret where either can capture it.

---

<!-- sdd:rule id="scope-bounding" tier="critical" -->
## 6. Scope Bounding & Atomic Progression
* **Rule:** Execute one task at a time in strict sequence. Do not refactor unrelated files or perform out-of-scope cleanups without explicit Auditor authorization.
* **Why this rule exists:**
  > An agent that touches files outside the current task makes the change hard to attribute, review, and revert, and breaks the handoff when a different session or agent picks up the work next.

---

<!-- sdd:rule id="factual-copy" tier="moderate" -->
## 7. Factual Technical Copy (No AI Slop)
* **Rule:** All documentation, user-facing copy, and commit messages must be factual, concise, and dense, following the `no-ai-slop` skill. The quality gate enforces its banned patterns.
* **Why this rule exists:**
  > Generic, promotional phrasing in docs and commit messages buries the one technical fact a future reader actually needs.

---

<!-- sdd:rule id="author-attribution" tier="moderate" -->
## 8. Author Attribution & Integrity
* **Rule:** Never attach `Co-Authored-By:` trailers crediting AI assistants to Git commits. The repository owner is the sole author. Before the first commit in a repository you have not committed to before, run `git config user.email` (and `user.name`) and confirm the result is the identity this project actually wants -- do not assume whatever the global default resolves to is correct, since it may be a different project's or a personal identity.
* **Why this rule exists:**
  > The project owner is the sole author of record; a Co-Authored-By trailer credits work no tool did unsupervised, and pollutes the commit graph for everyone after. A commit's author is never wrong by accident -- it is either the identity someone actually configured for this project, or nobody checked.
