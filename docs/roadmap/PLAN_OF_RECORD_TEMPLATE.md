# Plan of Record: [Initiative Name]

**Status:** Proposed | Active | Completed | Superseded  
**Auditor (Owner):** [Name / Role]  
**Target Completion:** [Date]  

---

## 1. Executive Summary and Scope

State the technical objective and operational motivation. Document the boundaries of the initiative.

* **Objective:** What problem this initiative solves.
* **Scope In:** Explicit list of features, layers, or systems to touch.
* **Scope Out:** Explicit list of related items that will remain untouched.

---

## 2. Phasing Strategy

Break work down into sequential phases. Each phase represents a cohesive set of tasks that leaves the repository in a deployable, tested state.

* **Phase 1: Foundation and Interfaces:** Data schemas, contracts, domain models.
* **Phase 2: Core Implementation:** Business logic, services, orchestration.
* **Phase 3: Integration and Client Exposure:** Routes, UI views, controllers.
* **Phase 4: Hardening and Cutover:** Migration verification, performance, deprecations.

---

## 3. Decisions and Trade-offs

Document design choices made during planning. Explain why alternative approaches were discarded.

* **Decision 1:** [Title]
  * **Selected Approach:** [Description]
  * **Alternatives Discarded:** [Option A, Option B]
  * **Rationale:** [Technical justification based on performance, simplicity, or risk]

---

## 4. Risks and Fallback Strategy

* **Risk 1:** [Description of potential failure mode]
  * **Mitigation:** [Proactive architectural guardrail]
  * **Rollback Plan:** [Concrete operational steps to revert if issues occur in production]
