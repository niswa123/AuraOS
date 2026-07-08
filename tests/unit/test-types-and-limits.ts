/**
 * AuraOS Unit Tests — Types, Default Limits & Billing Formula
 * Pure logic tests that require no external services.
 * Run: npx tsx tests/unit/test-types-and-limits.ts
 */

import { DEFAULT_LIMITS, MAX_LIMITS } from '../../src/core/sandbox/types.js';
import type { ResourceLimits } from '../../src/core/sandbox/types.js';

// ─── Test harness ───
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ❌ ${label}`);
  }
}

function assertEq(actual: any, expected: any, label: string) {
  assert(actual === expected, `${label} — expected ${expected}, got ${actual}`);
}

function section(title: string) {
  console.log(`\n━━━ ${title} ━━━`);
}

// ─── Clamp limits (replicate orchestrator logic locally) ───
function clampLimits(limits: Partial<ResourceLimits>): ResourceLimits {
  return {
    memoryBytes: Math.min(limits.memoryBytes ?? DEFAULT_LIMITS.memoryBytes, MAX_LIMITS.memoryBytes),
    cpuCores: Math.min(limits.cpuCores ?? DEFAULT_LIMITS.cpuCores, MAX_LIMITS.cpuCores),
    timeoutMs: Math.min(limits.timeoutMs ?? DEFAULT_LIMITS.timeoutMs, MAX_LIMITS.timeoutMs),
    pidsLimit: Math.min(limits.pidsLimit ?? DEFAULT_LIMITS.pidsLimit, MAX_LIMITS.pidsLimit),
    networkDisabled: limits.networkDisabled ?? DEFAULT_LIMITS.networkDisabled,
  };
}

// ─── Billing formula (replicate event-broker logic locally) ───
function computeBilling(durationMs: number, ramAllocatedMb: number) {
  const durationSeconds = durationMs / 1000;
  const costUsd = durationSeconds * (ramAllocatedMb / 1024) * 0.00001667;
  return { durationSeconds, costUsd };
}

// ─── Egress domain matching (replicate egress-proxy logic locally) ───
const ALLOWED_DOMAINS = [
  'api.openai.com',
  'api.anthropic.com',
  'api.cohere.ai',
  'api.groq.com',
  'github.com',
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org'
];

function isDomainAllowed(host: string): boolean {
  if (!host) return false;
  return ALLOWED_DOMAINS.some(allowed =>
    host === allowed || host.endsWith('.' + allowed)
  );
}

// ═══════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════

console.log('\n🧪 AuraOS Unit Tests — Types, Limits & Billing\n');

// ─── 1. Default Limits ───
section('1. DEFAULT_LIMITS values');

assertEq(DEFAULT_LIMITS.memoryBytes, 256 * 1024 * 1024, 'Default memory = 256 MB');
assertEq(DEFAULT_LIMITS.cpuCores, 0.5, 'Default CPU = 0.5 cores');
assertEq(DEFAULT_LIMITS.timeoutMs, 30_000, 'Default timeout = 30 s');
assertEq(DEFAULT_LIMITS.pidsLimit, 64, 'Default PID limit = 64');
assertEq(DEFAULT_LIMITS.networkDisabled, true, 'Default network = disabled');

// ─── 2. Max Limits ───
section('2. MAX_LIMITS values');

assertEq(MAX_LIMITS.memoryBytes, 1024 * 1024 * 1024, 'Max memory = 1 GB');
assertEq(MAX_LIMITS.cpuCores, 2.0, 'Max CPU = 2.0 cores');
assertEq(MAX_LIMITS.timeoutMs, 300_000, 'Max timeout = 5 min');
assertEq(MAX_LIMITS.pidsLimit, 256, 'Max PID limit = 256');
assertEq(MAX_LIMITS.networkDisabled, false, 'Max network = enabled');

// ─── 3. clampLimits — empty input uses defaults ───
section('3. clampLimits() — empty input');

const emptyClamp = clampLimits({});
assertEq(emptyClamp.memoryBytes, DEFAULT_LIMITS.memoryBytes, 'Empty → default memory');
assertEq(emptyClamp.cpuCores, DEFAULT_LIMITS.cpuCores, 'Empty → default cpu');
assertEq(emptyClamp.timeoutMs, DEFAULT_LIMITS.timeoutMs, 'Empty → default timeout');
assertEq(emptyClamp.pidsLimit, DEFAULT_LIMITS.pidsLimit, 'Empty → default pids');
assertEq(emptyClamp.networkDisabled, DEFAULT_LIMITS.networkDisabled, 'Empty → default network');

// ─── 4. clampLimits — values within range pass through ───
section('4. clampLimits() — values within range');

const withinRange = clampLimits({ memoryBytes: 128 * 1024 * 1024, cpuCores: 1.0, timeoutMs: 15_000, pidsLimit: 32 });
assertEq(withinRange.memoryBytes, 128 * 1024 * 1024, '128 MB passes through');
assertEq(withinRange.cpuCores, 1.0, '1.0 CPU passes through');
assertEq(withinRange.timeoutMs, 15_000, '15 s passes through');
assertEq(withinRange.pidsLimit, 32, '32 PIDs passes through');

// ─── 5. clampLimits — values exceeding max are clamped ───
section('5. clampLimits() — exceeding max → clamped');

const overMax = clampLimits({
  memoryBytes: 4 * 1024 * 1024 * 1024,  // 4 GB → clamped to 1 GB
  cpuCores: 8.0,                          // 8 → clamped to 2
  timeoutMs: 600_000,                     // 10 min → clamped to 5 min
  pidsLimit: 1024,                        // 1024 → clamped to 256
});
assertEq(overMax.memoryBytes, MAX_LIMITS.memoryBytes, '4 GB clamped to 1 GB');
assertEq(overMax.cpuCores, MAX_LIMITS.cpuCores, '8 cores clamped to 2');
assertEq(overMax.timeoutMs, MAX_LIMITS.timeoutMs, '600 s clamped to 300 s');
assertEq(overMax.pidsLimit, MAX_LIMITS.pidsLimit, '1024 pids clamped to 256');

// ─── 6. clampLimits — zero and negative values ───
section('6. clampLimits() — zero / negative edge cases');

const zeroClamp = clampLimits({ memoryBytes: 0, cpuCores: 0, timeoutMs: 0, pidsLimit: 0 });
assertEq(zeroClamp.memoryBytes, 0, 'Zero memory = 0 (no negative guard)');
assertEq(zeroClamp.cpuCores, 0, 'Zero CPU = 0');
assertEq(zeroClamp.timeoutMs, 0, 'Zero timeout = 0');
assertEq(zeroClamp.pidsLimit, 0, 'Zero pids = 0');

const negativeClamp = clampLimits({ memoryBytes: -100, cpuCores: -1 });
assert(negativeClamp.memoryBytes < 0, 'Negative memory passes through (no guard)');
assert(negativeClamp.cpuCores < 0, 'Negative CPU passes through (no guard)');

// ─── 7. Billing formula — standard cases ───
section('7. Billing formula — standard execution');

const bill1 = computeBilling(2659, 128);  // Real execution from dashboard
assertEq(bill1.durationSeconds, 2.659, 'Duration seconds = 2.659');
assert(Math.abs(bill1.costUsd - 0.00000554) < 0.00000002, `Cost ≈ $0.00000554 (got ${bill1.costUsd.toFixed(8)})`);

// ─── 8. Billing — zero duration ───
section('8. Billing formula — zero duration');

const bill0 = computeBilling(0, 128);
assertEq(bill0.costUsd, 0, 'Zero duration = $0.00');

// ─── 9. Billing — high duration / high RAM ───
section('9. Billing formula — heavy workload');

const billHeavy = computeBilling(300_000, 1024);  // 5 min, 1 GB
const expectedCost = 300 * 1.0 * 0.00001667;      // 300 s * 1 GB * rate
assert(Math.abs(billHeavy.costUsd - expectedCost) < 0.00001, `Heavy cost ≈ $${expectedCost.toFixed(5)}`);

// ─── 10. Egress domain filtering ───
section('10. Egress proxy — domain allowlist');

assert(isDomainAllowed('api.openai.com'), 'api.openai.com → allowed');
assert(isDomainAllowed('api.anthropic.com'), 'api.anthropic.com → allowed');
assert(isDomainAllowed('api.cohere.ai'), 'api.cohere.ai → allowed');
assert(isDomainAllowed('api.groq.com'), 'api.groq.com → allowed');
assert(isDomainAllowed('github.com'), 'github.com → allowed');
assert(isDomainAllowed('registry.npmjs.org'), 'registry.npmjs.org → allowed');
assert(isDomainAllowed('pypi.org'), 'pypi.org → allowed');
assert(isDomainAllowed('files.pythonhosted.org'), 'files.pythonhosted.org → allowed');

// ─── 11. Egress — blocked domains ───
section('11. Egress proxy — blocked domains');

assert(!isDomainAllowed('evil.com'), 'evil.com → blocked');
assert(!isDomainAllowed('google.com'), 'google.com → blocked');
assert(!isDomainAllowed('api.openai.com.evil.com'), 'api.openai.com.evil.com → blocked (suffix attack)');
assert(!isDomainAllowed(''), 'Empty string → blocked');
assert(!isDomainAllowed('openai.com'), 'openai.com (not api.openai.com) → blocked');

// ─── 12. Egress — subdomain matching ───
section('12. Egress proxy — subdomain matching');

assert(isDomainAllowed('sub.api.openai.com'), 'sub.api.openai.com → allowed (subdomain)');
assert(isDomainAllowed('deep.sub.github.com'), 'deep.sub.github.com → allowed (deep subdomain)');
assert(!isDomainAllowed('notgithub.com'), 'notgithub.com → blocked');

// ═══════════════════════════════════════════════════════════
//  Summary
// ═══════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(50));
console.log(`  Total: ${passed + failed} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);

if (failures.length > 0) {
  console.log('\n  Failed tests:');
  failures.forEach(f => console.log(`    • ${f}`));
}

console.log('═'.repeat(50) + '\n');
process.exit(failed > 0 ? 1 : 0);
