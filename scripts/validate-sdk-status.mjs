#!/usr/bin/env node
/**
 * Validates docs/sdk-status.json against the root README matrix and
 * checks that documented npm packages resolve on the public registry.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const status = JSON.parse(readFileSync(resolve(root, 'docs/sdk-status.json'), 'utf8'));
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

const errors = [];

for (const sdk of status.sdks) {
  if (sdk.readme) {
    const readmePath = resolve(root, sdk.readme);
    try {
      readFileSync(readmePath, 'utf8');
    } catch {
      errors.push(`Missing README for ${sdk.name}: ${sdk.readme}`);
    }
  }

  for (const pkg of sdk.packages ?? []) {
    if (pkg.registry === 'npm' && pkg.published !== false) {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`);
      if (!res.ok) {
        errors.push(`npm package not found: ${pkg.name}`);
        continue;
      }
      const data = await res.json();
      const latest = data['dist-tags']?.latest;
      if (pkg.version && latest !== pkg.version) {
        errors.push(
          `npm ${pkg.name}: sdk-status.json says ${pkg.version} but registry latest is ${latest}`,
        );
      }
    }
  }

  const rowNeedle = sdk.name.replace(' (Laravel)', '').replace(' SDK', '');
  const labels = [sdk.name, sdk.id.replace(/-/g, ' '), rowNeedle];
  if (!labels.some((label) => readme.includes(label))) {
    errors.push(`Root README missing SDK row or link for: ${sdk.name}`);
  }
}

const forbiddenInstallPatterns = [
  { pattern: /pip install causet-sdk/, sdk: 'python', allowed: false },
  { pattern: /composer require causet\/laravel-sdk/, sdk: 'php', allowed: false },
  { pattern: /go get github\.com\/causet-inc\/causet-sdk-go/, sdk: 'go', allowed: false },
];

const python = status.sdks.find((s) => s.id === 'python');
if (python?.packageDistribution === 'Source installation only' && /pip install causet-sdk/.test(readme)) {
  errors.push('Root README documents pip install causet-sdk but Python is source-only');
}

const php = status.sdks.find((s) => s.id === 'php');
if (
  php?.packageDistribution === 'Source installation only' &&
  /composer require causet\/laravel-sdk/.test(readme)
) {
  errors.push('Root README documents composer require but PHP SDK is source-only');
}

const go = status.sdks.find((s) => s.id === 'go');
if (
  go?.packageDistribution === 'Source installation only' &&
  /go get github\.com\/causet-inc\/causet-sdk-go/.test(readme)
) {
  errors.push('Root README documents go get but Go SDK is source-only');
}

if (/causet-saas-cloud|SaaS API/i.test(readme)) {
  errors.push('Root README still contains internal product naming (causet-saas-cloud / SaaS API)');
}

if (!readme.includes('docs.causet.io')) {
  errors.push('Root README should link to docs.causet.io');
}

if (!readme.includes('SUPPORT.md')) {
  errors.push('Root README should link to SUPPORT.md');
}

if (errors.length) {
  console.error('SDK status validation failed:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('SDK status validation passed.');
