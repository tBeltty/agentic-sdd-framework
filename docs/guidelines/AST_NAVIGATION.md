# 🧭 Codebase Navigation: AST First and Token Efficiency

This guide establishes the codebase exploration protocol for developers and autonomous AI agents using the **Agentic SDD Framework**.

---

## 1. The Core Problem: Context Bloat and Token Exhaustion

Traditional agent exploration relies on running broad `grep` commands or dumping whole source files into model context. This approach causes three compounding failures:

1. **Context Saturation:** Reading five 800-line files consumes 20,000+ tokens before any code is written.
2. **Loss of Precision:** Agents struggle with needle-in-a-haystack symbol tracing when flooded with irrelevant function bodies.
3. **Financial Cost:** Monorepo exploration costs scale linearly with repository lines of code.

---

## 2. The Solution: AST-First Hierarchy

Always follow the three-tier exploration hierarchy:

```text
Step 1: AST / Graph Query (Locate symbol, caller, or interface definition)
                   │
                   ▼ (If not found or graph stale)
Step 2: Scoped Grep (Search bounded by file extension or directory glob)
                   │
                   ▼ (After locating exact line bounds)
Step 3: Slice Inspection (Read only target lines, e.g. lines 40 to 80)
```

---

## 3. Objective Comparison of Navigation Adapters

| Adapter | Upstream Creator | Mechanism | Best For | Trade-offs |
| :--- | :--- | :--- | :--- | :--- |
| **`graphify`** | Graphify Labs | Relational graph + visual extraction | Monorepos, cross-layer dependency tracing | Requires Python 3.10+; index requires updates after edits. |
| **`ast-grep`** | Herrington Darkholme | Tree-sitter structural syntax matching | Syntax-aware structural grep, code migrations | Requires language parser support; no whole-repo graph visualization. |
| **`ripgrep`** | Andrew Gallant | Line-oriented SIMD regex engine | Fast text search, markdown/config inspection | Does not understand semantic code structure or imports. |
| **`lsp / scip`** | Sourcegraph | Language Server Protocol type indexing | Enterprise TypeScript, Go, Java, Rust | Heavier initial indexing pipeline; language-specific setups. |

---

## 4. How to Select Your Active Adapter

In `sdd.config.json`, set the adapter under `capabilities.astNavigation.adapter`:

* Choose **`graphify`** if you work in a medium-to-large multi-service monorepo and have Python available.
* Choose **`ast-grep`** if you want zero Python dependencies and fast structural syntax matching.
* Choose **`ripgrep`** if you are building a small project and prefer standard text utilities.
* Choose **`lsp`** if your primary language relies heavily on complex compiler type hierarchies.
