#!/usr/bin/env node

/**
 * scripts/check-versions.js
 * 
 * Monorepo & Configuration Version Sync Checker
 * Verifies that package.json and sdd.config.json are 100% in sync.
 */

const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const sddConfigPath = path.join(__dirname, '..', 'sdd.config.json');

if (!fs.existsSync(packageJsonPath)) {
    console.error('❌ package.json not found.');
    process.exit(1);
}

if (!fs.existsSync(sddConfigPath)) {
    console.error('❌ sdd.config.json not found.');
    process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const sddConfig = JSON.parse(fs.readFileSync(sddConfigPath, 'utf8'));

const pkgVersion = packageJson.version;
const configVersion = sddConfig.version;

console.log('\n======================================================');
console.log('  🏷️  Agentic SDD Framework: Version Sync Check');
console.log('======================================================\n');

console.log(`  - package.json:    ${pkgVersion}`);
console.log(`  - sdd.config.json: ${configVersion}\n`);

if (pkgVersion !== configVersion) {
    console.error(`❌ Version mismatch detected!`);
    console.error(`   package.json (${pkgVersion}) !== sdd.config.json (${configVersion})`);
    console.error('Action: Synchronize version strings before committing.\n');
    process.exit(1);
}

console.log('✅ Version manifests are 100% in sync.\n');
process.exit(0);
