/**
 * scripts/lib/config.js
 *
 * Loads and validates sdd.config.json against sdd.config.schema.json (same directory).
 * A missing file yields an empty object so every check uses its documented defaults.
 * An invalid file is an error: a typo must not silently switch a check off.
 * Keys starting with "x-" are free-form extensions and are not validated.
 */

const path = require('path');
const { readFile, WORKTREE } = require('./git');

const SCHEMA = require('./sdd.config.schema.json');

function typeOf(value) {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    if (Number.isInteger(value)) return 'integer';
    return typeof value;
}

// Validates the subset of JSON Schema used by sdd.config.schema.json.
function validate(value, schema, at, errors) {
    if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}`);
        return;
    }
    if (schema.type) {
        const actual = typeOf(value);
        const ok = actual === schema.type || (schema.type === 'number' && actual === 'integer');
        if (!ok) {
            errors.push(`${at}: expected ${schema.type}, got ${actual}`);
            return;
        }
    }
    if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
        errors.push(`${at}: must be >= ${schema.minimum}`);
    }
    if (schema['x-relative-path'] && typeof value === 'string') {
        const segments = value.split(/[\\/]/);
        if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || segments.includes('..')) {
            errors.push(`${at}: must be a path relative to the repository root, without ".."`);
        }
    }
    if (schema.items && Array.isArray(value)) {
        value.forEach((item, i) => validate(item, schema.items, `${at}[${i}]`, errors));
    }
    if (schema.properties && typeOf(value) === 'object') {
        for (const [key, child] of Object.entries(value)) {
            const where = `${at}.${key}`;
            if (schema.properties[key]) {
                validate(child, schema.properties[key], where, errors);
            } else if (schema.patternProperties && Object.keys(schema.patternProperties).some(p => new RegExp(p).test(key))) {
                continue;
            } else if (schema.additionalProperties === false) {
                const known = Object.keys(schema.properties).join(', ');
                errors.push(`${where}: unknown key (valid keys: ${known}; use an "x-" prefix for custom keys)`);
            }
        }
    }
}

function validateConfig(config) {
    const errors = [];
    validate(config, SCHEMA, 'sdd.config.json', errors);
    return errors;
}

function parseConfig(text) {
    let config;
    try {
        config = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (error) {
        throw new Error(`sdd.config.json is not valid JSON: ${error.message}`);
    }
    const errors = validateConfig(config);
    if (errors.length > 0) {
        throw new Error(`sdd.config.json is invalid:\n${errors.map(e => `  - ${e}`).join('\n')}`);
    }
    return config;
}

// Reads the configuration from the same source the checks read (working tree, index, commit).
function loadConfig(root, source = WORKTREE) {
    const buffer = readFile(root, 'sdd.config.json', source);
    return buffer ? parseConfig(buffer.toString('utf8')) : {};
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

module.exports = { SCHEMA, validateConfig, parseConfig, loadConfig, getIn };
