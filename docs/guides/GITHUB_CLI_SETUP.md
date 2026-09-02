# 🐙 GitHub CLI Setup & Zero-Trust Provisioning Guide

This guide establishes the standard Day-0 provisioning procedure for repositories built with the **Agentic SDD Framework**.

---

## 1. Why GitHub CLI (`gh`) over the Web UI?

Using the command-line interface (`gh`) instead of clicking through github.com provides three fundamental engineering advantages:

1. **Deterministic & Scriptable:** Ensures every repository is provisioned with identical security flags (private by default, clean `.gitignore`, standard branch).
2. **Eliminates URL Credential Leaks:** Cloning through `gh` uses authenticated keychain tokens or SSH agent keys, preventing hardcoded credentials in `.git/config` remote URLs.
3. **Automated Branch Governance:** Enables setting up branch protection rules and CI/CD secret environments directly from terminal scripts.

---

## 2. Authentication & Least-Privilege Scopes

Before running provisioning commands, verify your local authentication state:

```bash
gh auth status
```

### 🔒 Security Risk: Over-Privileged Personal Access Tokens (PAT)
When running `gh auth login`:
* **Recommended Protocol:** Choose `SSH` or `HTTPS` with web-browser verification.
* **Minimum Scopes Required:** `'repo'`, `'read:org'`, `'workflow'`.
* **FORBIDDEN:** Never grant `'admin:org'` or full account administration scopes to everyday CLI development machines.

---

## 3. Provisioning a New SDD Repository

To create and clone a clean, private repository from scratch:

```bash
# 1. Create remote private repo and clone to local disk
gh repo create <project-name> --private --description "Spec-Driven Development Project" --clone

# 2. Navigate into the project
cd <project-name>
```

---

## 4. Branch Protection Rules (The First Defense)

Autonomous AI agents must **never** be permitted to execute blind force-pushes (`git push --force`) to your production branch.

### Setting up Branch Protection via CLI:
Protect the `main` (or `master`) branch by requiring pull requests and status checks:

```bash
# Verify the default branch name
git branch -M main

# Enforce branch protection (requires GitHub Pro/Team for private repos or public repo)
gh api \
  --method PUT \
  "repos/:owner/:repo/branches/main/protection" \
  -f required_status_checks='{"strict":true,"contexts":["quality-gate"]}' \
  -f enforce_admins=true \
  -f required_pull_request_reviews=null \
  -f restrictions=null
```

---

## 5. Security Checklist Before First Commit

- [ ] Repository is set to **Private** (unless explicitly intended as open-source).
- [ ] `.gitignore` contains rules for `.env`, `.vault`, `scratch/`, and private keys.
- [ ] No personal access tokens or credentials are typed into terminal arguments that persist in shell history (`~/.zsh_history` or `~/.bash_history`).
