/**
 * scripts/lib/slop-patterns.js
 *
 * Single source of truth for the patterns enforced by check-copy-slop.js.
 * .agents/skills/no-ai-slop/SKILL.md documents the same rules for agents; keep both in sync.
 * Inspired by https://github.com/petergyang/no-ai-slop (MIT License).
 */

// Words banned outright. Context-dependent words from the skill (harness, simply,
// actually, literally, honestly) stay as writing guidance only: they have legitimate
// technical uses and would produce false positives.
const BANNED_WORDS = [
    'delve', 'delves', 'delving',
    'foster', 'fosters', 'fostering',
    'leverage', 'leverages', 'leveraged', 'leveraging',
    'utilize', 'utilizes', 'utilized', 'utilizing',
    'empower', 'empowers', 'empowering',
    'streamline', 'streamlines', 'streamlined', 'streamlining',
    'supercharge', 'supercharged', 'supercharging',
    'revolutionize', 'revolutionizes', 'revolutionizing',
    'embark', 'embarking',
    'robust', 'cutting-edge', 'game-changing', 'game changer', 'game-changer',
    'transformative', 'multifaceted', 'meticulous', 'meticulously', 'paramount',
    'ever-evolving', 'world-class', 'seamless', 'seamlessly', 'groundbreaking',
    'tapestry', 'beacon', 'paradigm shift'
];

// A clause boundary (comma, semicolon or dash) must separate both halves, so ordinary
// sentences like "it is not cached because it is generated per request" are not reported.
const BANNED_PATTERNS = [
    {
        name: 'Binary Contrast ("it is not X, it is Y")',
        regex: /\b(?:it['’]?s|it is|this is|that['’]?s|that is)\s+not\b[^.;:!?]{1,60}?[,;—–]\s*(?:but\s+)?(?:it['’]?s|it is|this is|that['’]?s|that is|rather)\b/i
    },
    {
        name: 'Throat-Clearing Opener',
        regex: /\b(?:here['’]?s the thing|it['’]?s worth noting that|it is worth noting that|it is important to (?:note|remember) that)\b/i
    },
    {
        name: 'Colon Reveal Hook',
        regex: /\b(?:the best part|here['’]?s the kicker)\s*:/i
    },
    {
        name: 'Faux-Insight Hook',
        regex: /\b(?:what nobody tells you)\b/i
    },
    {
        name: 'Fake-Profound Conclusion',
        regex: /\b(?:the future is already here|in conclusion)\b/i
    },
    {
        name: 'AI Buzzword',
        regex: new RegExp(`\\b(?:${BANNED_WORDS.map(w => w.replace(/[-\s]/g, '[-\\s]')).join('|')})\\b`, 'i')
    }
];

module.exports = { BANNED_WORDS, BANNED_PATTERNS };
