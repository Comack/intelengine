import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

async function loadFeaturesModule() {
  const sourcePath = resolve(root, 'src/services/forensics-signal-features.ts');
  const source = readFileSync(sourcePath, 'utf-8');
  const transpiled = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
  const encoded = Buffer.from(transpiled, 'utf-8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

const features = await loadFeaturesModule();

describe('Forensics signal feature helpers', () => {
  it('clamps values and computes confidence within expected bounds', () => {
    assert.equal(features.clampNumber(1.2, 0, 1), 1);
    assert.equal(features.clampNumber(-2, 0, 1), 0);
    assert.equal(features.clampNumber(0.5, 0, 1), 0.5);
    assert.ok(Math.abs(features.computeSignalConfidence(0.7, 0.08, 0.03) - 0.75) < 1e-9);
    assert.equal(features.computeSignalConfidence(0.98, 0.2, 0), 0.95);
    assert.equal(features.computeSignalConfidence(0.2, 0, 0.1), 0.52);
  });

  it('parses timestamps deterministically from number, date, and string inputs', () => {
    const iso = '2026-02-20T10:15:30.000Z';
    const parsedIso = features.parseTimestampMs(iso);
    assert.equal(parsedIso, Date.parse(iso));
    assert.equal(features.parseTimestampMs(1700000000000), 1700000000000);
    assert.equal(features.parseTimestampMs(new Date(iso)), Date.parse(iso));
    assert.equal(features.parseTimestampMs(''), null);
    assert.equal(features.parseTimestampMs('not-a-date'), null);
  });

  it('computes freshness penalties for fresh, aging, and stale signals', () => {
    const profile = {
      penaltyAfterMs: 30 * 60 * 1000,
      skipAfterMs: 90 * 60 * 1000,
      maxPenalty: 0.22,
    };
    const now = 1_700_000_000_000;
    const fresh = features.computeFreshnessPenalty(now - (10 * 60 * 1000), profile, now);
    const aging = features.computeFreshnessPenalty(now - (60 * 60 * 1000), profile, now);
    const stale = features.computeFreshnessPenalty(now - (2 * 60 * 60 * 1000), profile, now);

    assert.equal(fresh.isStale, false);
    assert.equal(fresh.penalty, 0);
    assert.equal(aging.isStale, false);
    assert.ok(aging.penalty > 0 && aging.penalty < profile.maxPenalty);
    assert.equal(stale.isStale, true);
    assert.equal(stale.penalty, profile.maxPenalty);
  });

  it('applies log scaling and stable bucketing for timestamp/value features', () => {
    const bucketedTs = features.bucketSignalTimestamp(1_700_000_123_456, 5 * 60 * 1000);
    assert.equal(bucketedTs % (5 * 60 * 1000), 0);
    assert.equal(features.bucketSignalTimestamp(-1, 5 * 60 * 1000), 0);

    assert.equal(features.bucketSignalValue(12.34, 0.5), 12.5);
    assert.equal(features.bucketSignalValue(-12.34, 0.5), -12.5);

    const scaled = features.logScale1p(99, 2);
    assert.ok(Math.abs(scaled - (Math.log1p(99) * 2)) < 1e-9);
    assert.equal(features.logScale1p(-10, 2), 0);
  });
});
