---
name: no-ai-slop
description: "MANDATORY for user-facing copy, documentation, and agent communication. Removes common AI-generated writing cliches, binary contrasts ('it is not X, it is Y'), empty buzzwords, throat-clearing openers, colon reveals, importance puffery, and em-dash overuse. Source: https://github.com/petergyang/no-ai-slop (MIT License)."
---

# No AI Slop: Clear, Factual Technical Communication

## Objective
Ensure every document, user-facing string, and technical report sounds factual, concise, and grounded in engineering reality, eliminating predictable AI writing patterns.

---

## ⛔ Banned Buzzwords & Empty Modifiers

Do not use decorative buzzwords that inflate importance without adding technical substance:

* **Verbs:** delve, foster, leverage, utilize, facilitate, empower, streamline, supercharge, elevate, embark, harness, revolutionize.
* **Adjectives:** robust, cutting-edge, game-changing, transformative, multifaceted, meticulous, paramount, ever-evolving, world-class, seamless, groundbreaking.
* **Nouns:** tapestry, realm, beacon, paradigm shift.
* **Empty adverbs and filler phrases:** crucially, fundamentally, literally, honestly, simply, actually, at the end of the day, it is worth noting that.

---

## ⛔ Banned Structural Patterns

| Pattern | Example | Required Fix |
| :--- | :--- | :--- |
| **Binary contrast** | "It is not a tool, it is an operating system." | State what it is directly: "It is an operating system." |
| **Throat-clearing** | "Here is the thing:", "It is important to remember that" | Remove opening filler; start directly with the fact. |
| **Colon reveal** | "The best part: it runs in memory." | Write as a plain sentence: "It runs in memory." |
| **Faux-insight** | "What nobody tells you about state management..." | State the technical constraint directly. |
| **Importance puffery** | "Marks a pivotal moment in our architecture." | State the empirical metric or change. |
| **Fake-profound ending** | "The future of coding has arrived." | End on the last concrete technical deliverable. |
| **Em dash as rhythm crutch** | "We built this — with speed — to scale." | Use commas or split into clear sentences. Max 1 em-dash per long document. |

---

## 📋 Technical Writing Principles

1. **Active Voice & Factual Density:** Explain what the code does, what parameters it receives, and what command validates it.
2. **State Measurable Facts:** Replace "ultra-fast performance" with measured latency or memory consumption (for example: "< 30MB RAM, < 50ms startup").
3. **No Unverifiable Claims:** If a metric has not been empirically benchmarked, do not state it as fact.

---

## 🔧 Automated Enforcement

`scripts/check-copy-slop.js` enforces the high-precision subset of these rules on `.md`, `.mdx`, and `.txt` files, using the pattern list in `scripts/lib/slop-patterns.js`. Keep that file and this skill in sync.

* **Enforced:** every banned verb, adjective, and noun above; binary contrast; throat-clearing; colon reveal; faux-insight; fake-profound endings; em dashes above `capabilities.noAiSlop.maxEmDashes` per file (default 1).
* **Guidance only:** the empty adverbs (simply, actually, literally, honestly) and importance puffery. They have legitimate technical uses, so automated checks would produce false positives.
* **Not checked:** fenced code blocks, inline code, and table rows.
