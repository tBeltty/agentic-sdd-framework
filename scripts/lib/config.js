/**
 * scripts/lib/config.js
 *
 * Loads sdd.config.json from the repository root. A missing file yields an empty
 * object so every check falls back to its documented defaults.
 */

const fs = require('fs');
const path = require('path');

function loadConfig(root) {
    const configPath = path.join(root, 'sdd.config.json');
    if (!fs.existsSync(configPath)) return {};
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        throw new Error(`sdd.config.json is not valid JSON: ${error.message}`);
    }
}

// getIn(config, 'capabilities.noAiSlop.enabled', true)
function getIn(object, keyPath, fallback) {
    let current = object;
    for (const key of keyPath.split('.')) {
        if (current === null || typeof current !== 'object' || !(key in current)) return fallback;
        current = current[key];
    }
    return current === undefined ? fallback : current;
}

module.exports = { loadConfig, getIn };
