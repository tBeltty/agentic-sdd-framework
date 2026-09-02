---
name: ast-navigator
description: "MANDATORY for codebase exploration, symbol lookups, and dependency tracing. Enforces AST-first structural navigation before falling back to full-text grep, minimizing token usage and context clutter. Supports pluggable adapters: Graphify, ast-grep, ripgrep, and LSP/SCIP."
---

# AST Navigator Protocol: Token-Efficient Code Exploration

## Objective
Enable AI coding agents to navigate complex codebases by querying Abstract Syntax Tree (AST) representations and dependency graphs first, drastically reducing LLM context consumption compared to reading entire files or running unbounded text searches.

---

## 🧭 Navigation Hierarchy

1. **Tier 1 (AST / Graph Query):** Query structural dependencies, class hierarchies, and symbol definitions using the configured adapter in `sdd.config.json`.
2. **Tier 2 (Fallback to Grep):** Fall back to targeted regex grep only when:
   * The AST adapter returns no matches.
   * The graph index is known to be stale and cannot be updated immediately.
   * Exact line-level character sequences (string literals, CSS rules, comments) are required.
3. **Tier 3 (File Inspection):** Read specific line slices (`view_file`) only after locating the exact symbol and line numbers. Never dump entire 1,000-line files into context without target line bounds.

---

## 🔌 Supported Adapters

The active adapter is declared in `sdd.config.json` under `capabilities.astNavigation.adapter`. Refer to individual adapter guides in `adapters/`:

* **`graphify`:** Visual and relational knowledge graph by Graphify Labs. Ideal for token conservation in large monorepos with Python runtime available.
* **`ast-grep`:** Native binary Treesitter structural search. Zero Python dependency, fast structural pattern matching.
* **`ripgrep`:** High-speed regex text search. Universal baseline present in all developer environments.
* **`lsp`:** Language Server Protocol and SCIP indexing for typed codebases (TypeScript, Go, Rust, Java).

---

## 🚨 Verification Rule Before Claiming Compliance
A missing edge or symbol in an AST index is **not** definitive proof that a dependency does not exist. Before certifying architectural compliance or absence of a vulnerability, always verify the actual import statements of the target file.
