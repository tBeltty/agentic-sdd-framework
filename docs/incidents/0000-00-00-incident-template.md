# Incident Post-Mortem: [YYYY-MM-DD] [Incident Title]

**Date:** [YYYY-MM-DD]  
**Author / Investigator:** [Name]  
**Severity:** P1 (Critical) | P2 (Major) | P3 (Minor)  
**Status:** Resolved  

---

## 1. Summary and Impact
Briefly describe what failed, which services were affected, and how the issue was detected (e.g. automated alert, customer report, test suite).

---

## 2. Timeline
* **[Time UTC]:** Initial symptom observed.
* **[Time UTC]:** Investigation started; root cause identified.
* **[Time UTC]:** Remediation deployed.
* **[Time UTC]:** Verification completed; service restored.

---

## 3. Root Cause Analysis
Explain the underlying mechanical, configuration, or architectural failure without speculation. State what code path or environment variable triggered the failure.

---

## 4. Remediation and Verification
* **Fix Applied:** [Link to commit or description of change]
* **Verification Command:** [Terminal command used to reproduce and verify the fix]

---

## 5. Inviolable Rule Created
Document the permanent rule added to `.agents/AGENTS.md` to ensure AI agents and engineers cannot repeat this error.
