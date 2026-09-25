# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Install a specific release
with `npx github:tBeltty/agentic-sdd-framework#v<version>`.

## [Unreleased]

## [1.3.0] - 2026-09-25

### Fixed
- The pre-push hook checked the working tree instead of the pushed commits, so a committed secret
  removed only from the working tree was pushed. The hook now passes the push to
  `quality-gate.js --push`, which checks each pushed commit and scans every new commit for secrets.
- Git failures were swallowed: outside a repository, or when Git errored, every check reported
  "0 files" and passed. Checks now fail with the Git error.
- `sdd.config.json` was not validated: a typo or wrong type silently disabled a check (for example
  `"exclude": "docs/"` switched the prose linter off). The file is validated against
  `scripts/lib/sdd.config.schema.json` on every run; custom keys use an `x-` prefix. A UTF-8 BOM is
  accepted.
- Specification check bypasses: CRLF line endings hid every task; an unknown status such as "Done"
  disabled the rules; checkbox tasks without a bold `**ID:**` were ignored; any `Last Verified`
  containing "PASS" was accepted; and a PASS stayed valid after the verified files changed.
- The secret scanner missed PGP private keys, credentials in URLs, secret-named assignments
  (`password`, `client_secret`, `access_token`, ...), and tracked secret files (`.env`, `id_rsa`,
  `*.key`, `*.p12`). Pragma suppressions are now counted in the report.
- `maxEmDashes` counted lines instead of dashes; fences closed on any fence marker.
- The pre-push hook installer wrote into a `core.hooksPath` directory shared by other repositories;
  it now leaves hook managers alone and prints the command to add. The hook falls back to the
  absolute Node.js path when `node` is not on PATH, and the relative gate path is computed between
  real (symlink-resolved) paths.
- `sdd-init` ignored `--target <dir>` (space form) and unknown or misspelled flags; both are
  handled now, and `--help` prints usage. When an existing `AGENTS.md` or `CLAUDE.md` is left
  untouched, the next steps say so instead of claiming the rules load automatically.
- `.claude/skills/` copies (used where symlinks are unavailable) were never refreshed; `--force`
  refreshes them.
- `--staged` was inconsistent: the Rigor check and the version check read the working tree.
- Rigor mode accepted any `auditkit` version; it now requires 0.3.0 or newer.

### Added
- `sdd-verify --task <ID> -- <command>` records a command's transcript as task evidence with its
  exit code and a hash; the gate rejects edited or failing recorded evidence, counts hand-written
  evidence, and rejects it when `specification.requireRecordedEvidence` is true.
- `sdd-verify --record` writes a state fingerprint and fails when the command modifies tracked files.
- `specification.verifyTimeoutSeconds` (default 900) and `specification.verifyShell`.
- `quality-gate.js --ref=<commit>` and `--push [remote]`. In push mode, a ref whose commit is
  already on the remote (such as a tag on a published commit) publishes nothing new and is skipped.
- `security.allowFiles` for tracked files with sensitive names.
- `.sdd/VERSION` in installed projects; the wizard reports tooling upgrades.
- CI runs on Linux, macOS, and Windows; `.gitattributes` keeps line endings consistent.

### Changed
- The README describes what the framework does and what each check enforces, including its limits.
- `package.json` no longer declares a `main` entry (requiring the package ran the wizard).

## [1.2.0] - 2026-09-25

### Added
- The quality gate checks the specification: Lite specs need evidence for checked tasks and a
  recorded PASS to be completed; Rigor documents are checked with `auditkit lint`.
- `sdd-verify` runs the spec's verification command and records the result.
- Rigor documents use the auditkit format, vendored from auditor-executor-protocol, with a CI check
  that the vendored files match the canonical repository.

## [1.1.0] - 2026-09-25

### Added
- Root `AGENTS.md`, `CLAUDE.md`, and `.claude/skills/` so agents load the rules without a prompt.
- Install into an existing project with `npx github:tBeltty/agentic-sdd-framework`.
- File size limit check; `node:test` suites; single-process quality gate.

### Changed
- Node.js 22 LTS or newer is required.

## [1.0.0] - 2026-09-02

### Added
- Initial release: constitution and context templates, Lite and Rigor specification templates,
  strategic-cto, no-ai-slop, ast-navigator, and auditor-executor-protocol skills, bootstrapping
  wizard, and quality gate scripts.
