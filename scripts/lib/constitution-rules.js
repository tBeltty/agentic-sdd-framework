/**
 * scripts/lib/constitution-rules.js
 *
 * Identity of the 8 default constitution rules the wizard offers, shared by the wizard
 * (rule selection), the constitution check (what "critical" and "moderate" mean), and
 * sdd-add-rule (validating --fulfills). The id is the stable handle: an expert can write
 * their own rule text under the same id and the gate still recognizes it as fulfilling
 * that slot, because it never matches on heading text, only on this tag.
 */

const RULES = {
    'discovery-first': { tier: 'moderate', label: 'Discovery First' },
    'evidence-driven-debugging': { tier: 'moderate', label: 'Evidence-Driven Debugging' },
    'mandatory-verification': { tier: 'critical', label: 'Mandatory Verification' },
    'closed-network-testing': { tier: 'moderate', label: 'Closed-Network Testing Isolation' },
    'zero-trust-secrets': { tier: 'critical', label: 'Zero-Trust Secrets Management' },
    'scope-bounding': { tier: 'critical', label: 'Scope Bounding & Atomic Progression' },
    'factual-copy': { tier: 'moderate', label: 'Factual Technical Copy (No AI Slop)' },
    'author-attribution': { tier: 'moderate', label: 'Author Attribution & Integrity' }
};

const CRITICAL_IDS = Object.keys(RULES).filter(id => RULES[id].tier === 'critical');
const MODERATE_IDS = Object.keys(RULES).filter(id => RULES[id].tier === 'moderate');

module.exports = { RULES, CRITICAL_IDS, MODERATE_IDS };
