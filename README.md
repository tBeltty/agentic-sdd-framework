# Agentic SDD Framework

> **Deterministic governance for AI coding agents.** Stop Claude Code, Cursor, Antigravity, and Codex from hallucinating completed tasks and drifting out of scope.

[![npm version](https://img.shields.io/npm/v/agentic-sdd-framework.svg)](https://www.npmjs.com/package/agentic-sdd-framework)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: 22+](https://img.shields.io/badge/node-22%2B%20LTS-green.svg)](https://nodejs.org/)
[![Quality Gate](https://github.com/tBeltty/agentic-sdd-framework/actions/workflows/quality-gate.yml/badge.svg?branch=main)](https://github.com/tBeltty/agentic-sdd-framework/actions)

---

## The Problem

AI coding agents write code fast, but uncontrolled:
- They check off `[x] Done` without actually running the code.
- They silently guess the stack, add dependencies, and drift from what was asked.
- They pass a manual review because reading terminal output line by line is tedious, so nobody does it every time.

## The Solution

Agentic SDD adds a specification lifecycle to your repository that an agent cannot talk its way around:
1. **Rules that load without a prompt.** `AGENTS.md` and `CLAUDE.md` point every supported agent at a constitution before it writes a line of code.
2. **Evidence, not claims.** A task cannot be checked off by hand: `sdd-verify` runs the command and stamps the result with a hash tied to the exact file state it verified.
3. **A gate that actually blocks.** A pre-push hook fails the push, before it reaches `origin`, if evidence is missing, faked, or stale.

---

## See It Work

```text
$ git push
❌ T1 is checked but has no evidence.
   Quality gate failed — push rejected.

$ sdd-verify --task T1 -- npm test
$ 42 passed
✅ T1: exit 0, evidence recorded in docs/SPEC.md.

$ git add -A && git commit -m "T1: parser" && git push
✅ Quality gate passed.
```

Nobody edits the spec by hand to mark a task done: `sdd-verify` is the only thing allowed to write evidence, and it only writes what actually happened.

---

## Quickstart

```bash
cd your-project
npx github:tBeltty/agentic-sdd-framework#v1.4.0
```

The interactive wizard asks a few questions (specification mode, coding agent skills, runtime) and sets up agent rules, a starter spec, and the pre-push hook. Non-interactive:

```bash
npx github:tBeltty/agentic-sdd-framework#v1.4.0 --express --mode=lite --runtime=node-24-lts
```

**Requirements:** Git and Node.js 22 LTS or newer (24 LTS recommended), for a project in any language. That's it. [Rigor mode](#progressive-modes-lite-vs-rigor) needs one more tool; see below.

<details>
<summary>Other ways to install</summary>

**Start from a clone:** use the framework repository itself as the starting point of a new project.

```bash
git clone --branch v1.4.0 https://github.com/tBeltty/agentic-sdd-framework.git my-project
cd my-project
node scripts/sdd-init.js
```

**Pin a release tag.** `#v1.4.0` above pins the exact release, so a later change to `main` never reaches you unannounced. See [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

</details>

---

## How It Works: The 3 Pillars

1. **Constitution (`AGENTS.md`, `CLAUDE.md`):** 8 non-negotiable rules, each with a "why this rule exists" field, loaded automatically by every supported agent. No prompt engineering required to keep an agent inside its lane.
2. **Evidence-Based Spec (`sdd-verify`):** `docs/SPEC.md` holds atomic tasks; `sdd-verify --task <ID> -- <command>` runs a command and records its output as that task's evidence, and `sdd-verify --record` does the same for the spec's overall verification command. See [docs/architecture/spec-integrity.md](docs/architecture/spec-integrity.md) for exactly how that evidence is hashed and checked.
3. **Quality Gate (pre-push hook):** before a push reaches `origin`, it's checked for secrets, low-effort AI prose, oversized files, and specification evidence, in one process with one exit code.

---

## Progressive Modes: Lite vs. Rigor

Projects start simple and scale as complexity grows. The mode is set in `sdd.config.json`.

| | 🟢 Lite (default) | 🔴 Rigor (opt-in) |
| :--- | :--- | :--- |
| **Use it for** | Solo developers, utilities, early-stage MVPs | Multi-agent handoffs, asynchronous work, regulated domains |
| **Spec lives in** | One file: `docs/SPEC.md` | `docs/roadmap/`: a plan, an execution guide, a compliance log, and remediation annexes |
| **Format** | Tasks with recorded evidence and a verification gate | The [auditor-executor-protocol](https://github.com/tBeltty/auditor-executor-protocol) document set, with negative-control gates |
| **Extra requirement** | None | Python 3.9+ and `auditkit`: `pipx install git+https://github.com/tBeltty/auditor-executor-protocol` |

---

## Commands & CLI Reference

<details>
<summary><strong>Wizard flags</strong> (<code>sdd-init</code>)</summary>

Flags take `--flag=value` or `--flag value`. Unknown flags are an error.

| Flag | Values | Default |
| :--- | :--- | :--- |
| `--express` | Non-interactive run | Guided mode on a terminal |
| `--target=<dir>` | Project to provision | Current directory |
| `--name=<name>` | Project name | Target directory name |
| `--runtime=<id>` | `node-24-lts`, `go-1.23`, `python-3.12`, ... | `node-24-lts` |
| `--mode=<mode>` | `lite`, `rigor` | `lite` |
| `--ast=<adapter>` | `ast-grep`, `graphify`, `ripgrep`, `lsp` | `ast-grep` |
| `--concurrency=`, `--hardware=`, `--workload=` | Discovery answers recorded in ADR-0001 | Small internal service |
| `--i18n`, `--pwa` | Enable the capability flags | Disabled |
| `--force` | Refresh copied skills, templates, and `.claude/skills/` copies | Keep existing copies |
| `--help` | Print usage | |

Rerunning the wizard is safe: existing documents are kept, `sdd.config.json` is merged and validated (`x-` prefixed keys are free-form), and `AGENTS.md` / `CLAUDE.md` are only rewritten while they carry the `sdd:managed` marker.

</details>

<details>
<summary><strong>What the wizard generates</strong></summary>

| Path | Purpose |
| :--- | :--- |
| `AGENTS.md` | Entry point read automatically by Codex, Cursor, and other AGENTS.md-aware agents |
| `CLAUDE.md` | Imports the entry point, constitution, and context into Claude Code |
| `.claude/skills/` | Symlinks to `.agents/skills/` (copies where symlinks are unavailable) |
| `.agents/AGENTS.md` | Constitution: 8 non-negotiable rules |
| `.agents/CONTEXT.md` | Project facts, incident registry, technical debt, and non-goals |
| `docs/SPEC.md` (Lite) or `docs/roadmap/` (Rigor) | Active specification documents, checked by the quality gate |
| `docs/decisions/ADR-0001-stack-and-architecture.md` | Stack decision record seeded with the discovery answers |
| `sdd.config.json` | Configuration, validated against [`scripts/lib/sdd.config.schema.json`](scripts/lib/sdd.config.schema.json) |
| Git `pre-push` hook | Runs the quality gate on the pushed commits; an existing hook is kept as `pre-push.local` and runs first |

When `core.hooksPath` is set (Husky, lefthook, or a shared hooks directory), the wizard installs nothing there and prints the command to add instead.

</details>

<details>
<summary><strong>Quality gate</strong> (<code>quality-gate.js</code>)</summary>

Runs every check in one process, exits 1 if any fails. Each run reads files from one source:

| Invocation | Checks |
| :--- | :--- |
| *(no flag)* | Tracked files in the working tree |
| `--staged` | The index: what the next commit contains |
| `--ref=<commit>` | The content of that commit |
| `--push [remote]` | Pre-push mode: every check on each pushed ref's tip, plus a secret scan of every new commit in the push |

Unknown flags are errors. A check that cannot read the repository fails loudly instead of reporting "0 files, clean".

| Check | Enforces |
| :--- | :--- |
| Secret leak scanner | Provider keys, private key blocks, credentials in URLs, secret-named assignments, tracked secret files |
| No-AI-Slop copy linter | Rejects generic AI-written prose patterns |
| File size limit | `architecture.maxLocPerFile` |
| Specification check | Status, evidence, and verification gate rules (see below) |
| Version sync | `package.json` and `sdd.config.json` versions match (framework repo only) |

**Specification check, Lite mode:** exactly one Status line (`Draft`, `In Progress`, `Completed`); every checked task has recorded, unedited evidence; `In Progress`/`Completed` need a real verification command and expected output; `Completed` needs every task checked and an unedited PASS from `sdd-verify --record` matching the current file state. **Rigor mode:** `auditkit lint docs/roadmap` exits 0.

Full mechanism (hashing, CommonMark parsing subset, timeouts): [docs/architecture/spec-integrity.md](docs/architecture/spec-integrity.md).

</details>

---

<details>
<summary><strong>Repository Layout</strong></summary>

```text
agentic-sdd-framework/
├── .agents/
│   ├── AGENTS.template.md         # Constitution template (8 rules)
│   ├── CONTEXT.template.md        # Operational memory template
│   ├── ENTRYPOINT.template.md     # Root AGENTS.md template
│   └── skills/
│       ├── strategic-cto/         # 4-Pillar Discovery, Anti-Bloat, ROI Verdict
│       ├── auditor-executor-protocol/ # Execution protocol (tBeltty/auditor-executor-protocol)
│       ├── no-ai-slop/            # Factual copy rules (petergyang/no-ai-slop)
│       └── ast-navigator/         # Pluggable adapters (graphify, ast-grep, ripgrep, lsp)
│
├── docs/
│   ├── SPEC_TEMPLATE.md           # Lite Mode template
│   ├── architecture/              # How the gate and spec integrity work internally
│   ├── decisions/ADR_TEMPLATE.md  # Architecture Decision Record template
│   ├── roadmap/templates/         # Rigor Mode templates (vendored from auditkit)
│   ├── incidents/                 # Post-mortem template
│   ├── guides/                    # Credential tiers, GitHub CLI setup
│   └── guidelines/                # AST navigation adapter comparison
│
├── scripts/
│   ├── sdd-init.js                # Bootstrapping wizard (guided and express)
│   ├── quality-gate.js            # Runs every check (working tree, index, commit, or push)
│   ├── verify-no-secrets.js       # Credential scanner
│   ├── check-copy-slop.js         # No-AI-Slop linter
│   ├── check-file-size.js         # maxLocPerFile enforcement
│   ├── check-spec.js              # Specification evidence check
│   ├── sdd-verify.js              # Runs and records verification commands and task evidence
│   ├── check-versions.js          # Framework version sync
│   ├── check-system-prerequisites.js # Day-0 Git, gh CLI, and SSH checks
│   ├── install-git-hooks.js       # pre-push hook installer
│   ├── lib/                       # Git sources, config schema, spec parser, provisioning
│   └── dev/                       # Vendoring sync and the spec parser's differential fuzz
│
├── test/                          # node:test suites (npm test)
├── CHANGELOG.md                   # Release notes
└── sdd.config.json                # Configuration of this repository
```

</details>

---

## Attributions & License

This repository is [MIT licensed](LICENSE). It integrates, adapts, or provides adapters for:

| Component | Author | License |
| :--- | :--- | :--- |
| [Auditor-Executor Protocol](https://github.com/tBeltty/auditor-executor-protocol) | tBeltty | MIT |
| [Spec-Kit Concepts](https://github.com/github/spec-kit) | GitHub | MIT |
| [No-AI-Slop](https://github.com/petergyang/no-ai-slop) | Peter Yang | MIT |
| [Graphify](https://github.com/Graphify-Labs/graphify) | Graphify Labs | Apache 2.0 |
| [ast-grep](https://github.com/ast-grep/ast-grep) | Herrington Darkholme | MIT |
| [ripgrep](https://github.com/BurntSushi/ripgrep) | Andrew Gallant | MIT / Unlicense |
| [SCIP / LSP](https://github.com/scip-code/scip) | SCIP Code (originally Sourcegraph) | Apache 2.0 |

The vendored `no-ai-slop` skill keeps its upstream MIT license ([`.agents/skills/no-ai-slop/LICENSE`](.agents/skills/no-ai-slop/LICENSE)).
