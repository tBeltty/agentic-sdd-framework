# 🔐 Zero-Trust Secret Architecture & Credential Registry

This document establishes the **Three-Tier Secret Isolation Model** for repositories managed with the **Agentic SDD Framework**.

---

## 🏛️ The Three-Tier Secret Isolation Model

AI agents are powerful code executors, but they must be treated under a **Zero-Trust Model**. Secrets are categorized into three isolated tiers to ensure credentials can never be leaked through code, git history, or agent context logs.

```text
┌────────────────────────────────────────────────────────┐
│ Tier 1: Production Host Secrets                        │
│ - Stored ONLY on production hosts (VPS/Cloud)          │
│ - Read directly by the running application process     │
│ - Never checked into Git, never in developer workspaces │
└────────────────────────────────────────────────────────┘
                           ▲
┌────────────────────────────────────────────────────────┐
│ Tier 2: CI/CD Execution Secrets                        │
│ - Stored in GitHub Actions Secrets                     │
│ - Injected ephemeral into runner memory                │
│ - Masked automatically from build & test logs          │
└────────────────────────────────────────────────────────┘
                           ▲
┌────────────────────────────────────────────────────────┐
│ Tier 3: Agent Diagnostic Vault (OUTSIDE REPOSITORY)    │
│ - Location: ~/secrets/<project-name>/.vault            │
│ - Filesystem permissions: chmod 600 (User-only read)   │
│ - Agent reads from disk; NEVER asks user to paste keys │
└────────────────────────────────────────────────────────┘
```

---

## 🚨 Inviolable Rules for AI Coding Agents

1. **NEVER Ask the User to Paste a Secret in Chat:**
   Asking the user to paste an API key or password into a conversation stores that credential in model training logs and session history.
2. **NEVER Write Secrets to Tracked Files:**
   Credentials must never be hardcoded into source code, test files, configs, or markdown artifacts.
3. **NEVER Log Credentials to Console or Files:**
   Avoid `console.log(process.env)` or printing authorization headers during debugging.
4. **Always Read from the Tier 3 Vault:**
   When an agent requires read-only diagnostic access (e.g. Sentry API, GitHub API, Cloudflare API), it must read directly from `~/secrets/<project-name>/.vault` using local filesystem read tools.

---

## 🛠️ Setting Up the Tier 3 Local Vault

Run this setup once on your local developer machine:

```bash
# 1. Create secure secrets directory outside of any git repository
mkdir -p ~/secrets/<project-name>

# 2. Create the vault file
touch ~/secrets/<project-name>/.vault

# 3. Restrict permissions to owner-only read/write
chmod 600 ~/secrets/<project-name>/.vault
```

### Format of `.vault`:
```bash
# Key-value pairs read by diagnostic tools
GITHUB_TOKEN=gho_xxxxxxxxxxxxxxxxxxxx
SENTRY_AUTH_TOKEN=sntrys_xxxxxxxxxxxxxxxxxxxx
```

---

## 🛡️ Pre-Commit Verification Scanner

Before committing code, the repository enforces `scripts/verify-no-secrets.js`. Any commit containing a staged secret or private key will be blocked immediately.
