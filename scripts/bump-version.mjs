#!/usr/bin/env node
// Bumps all four publishable packages to the same version in lockstep,
// and updates `@mast-ai/core` references in dependents to match.
//
// Usage: node scripts/bump-version.mjs <version>
// Example: node scripts/bump-version.mjs 0.2.0

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PACKAGES = ['core', 'google-genai', 'built-in-ai', 'react-ui'];

const newVersion = process.argv[2];
if (!newVersion || !SEMVER.test(newVersion)) {
  console.error('Usage: node scripts/bump-version.mjs <version>');
  console.error('Example: node scripts/bump-version.mjs 0.2.0');
  process.exit(1);
}

const corePin = `^${newVersion}`;
const updated = [];

for (const pkg of PACKAGES) {
  const path = join('packages', pkg, 'package.json');
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const previous = json.version;
  json.version = newVersion;

  for (const depKey of ['dependencies', 'peerDependencies']) {
    if (json[depKey]?.['@mast-ai/core']) {
      json[depKey]['@mast-ai/core'] = corePin;
    }
  }

  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  updated.push({ pkg, previous, next: newVersion });
}

for (const { pkg, previous, next } of updated) {
  console.log(`@mast-ai/${pkg}: ${previous} -> ${next}`);
}

console.log(`
Next steps:
  npm install                         # refresh package-lock
  npm run format                      # normalise package.json formatting
  git add packages/*/package.json package-lock.json
  git commit -m "chore: release v${newVersion}"
  git tag v${newVersion}
  git push origin <branch> --tags
`);
