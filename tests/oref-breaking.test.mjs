import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'src', 'services', 'breaking-news-alerts.ts'), 'utf8');

describe('breaking-news-alerts oref_siren integration', () => {
  it('includes oref_siren in origin union type', () => {
    assert.ok(SRC.includes("'oref_siren'"), 'origin type should include oref_siren');
  });

  it('exports dispatchOrefBreakingAlert function', () => {
    assert.ok(SRC.includes('export function dispatchOrefBreakingAlert('), 'should export dispatchOrefBreakingAlert');
  });

  it('imports OrefAlert type', () => {
    assert.ok(SRC.includes("import type { OrefAlert }") || SRC.includes("import { OrefAlert }"), 'should import OrefAlert');
  });

  it('builds headline with location overflow count', () => {
    assert.ok(SRC.includes('+${overflow} areas'), 'should show overflow count');
  });

  it('limits shown locations to 3', () => {
    assert.ok(SRC.includes('slice(0, 3)'), 'should limit to 3 locations');
  });

  it('uses stable dedupe key from alert identifiers', () => {
    assert.ok(SRC.includes("'oref:'"), 'dedupe key should start with oref:');
    assert.ok(SRC.includes('.sort()'), 'key parts should be sorted for stability');
  });

  it('sets threatLevel to critical', () => {
    assert.ok(SRC.includes("threatLevel: 'critical'"), 'oref alerts should be critical');
  });

  it('bypasses global cooldown (no isGlobalCooldown check)', () => {
    const fnBody = SRC.slice(SRC.indexOf('function dispatchOrefBreakingAlert'), SRC.indexOf('export function initBreakingNewsAlerts'));
    assert.ok(!fnBody.includes('isGlobalCooldown'), 'should not check global cooldown');
  });

  it('checks isDuplicate for per-event dedupe', () => {
    const fnBody = SRC.slice(SRC.indexOf('function dispatchOrefBreakingAlert'), SRC.indexOf('export function initBreakingNewsAlerts'));
    assert.ok(fnBody.includes('isDuplicate'), 'should check isDuplicate');
  });

  it('returns early when settings disabled or no alerts', () => {
    const fnBody = SRC.slice(SRC.indexOf('function dispatchOrefBreakingAlert'), SRC.indexOf('export function initBreakingNewsAlerts'));
    assert.ok(fnBody.includes('!settings.enabled') && fnBody.includes('!alerts.length'), 'should guard settings and empty alerts');
  });
});

describe('data-loader oref breaking news wiring', () => {
  const DL = readFileSync(join(__dirname, '..', 'src', 'app', 'data-loader.ts'), 'utf8');

  it('imports dispatchOrefBreakingAlert', () => {
    assert.ok(DL.includes('dispatchOrefBreakingAlert'), 'data-loader should import dispatchOrefBreakingAlert');
  });

  it('routes initial OREF fetch through handleOrefAlertsUpdate', () => {
    const orefSection = DL.slice(DL.indexOf('// OREF sirens'), DL.indexOf('// GPS/GNSS'));
    assert.ok(orefSection.includes('this.handleOrefAlertsUpdate(data)'), 'initial fetch should delegate to shared handler');
  });

  it('routes OREF subscription updates through handleOrefAlertsUpdate callback', () => {
    assert.ok(
      DL.includes('onOrefAlertsUpdate((update) => this.handleOrefAlertsUpdate(update))'),
      'subscription updates should use the shared handler',
    );
  });

  it('dispatches breaking alerts inside handleOrefAlertsUpdate when alerts are present', () => {
    const start = DL.indexOf('private handleOrefAlertsUpdate');
    const end = DL.indexOf('private async tryFetchDigest');
    const handlerBody = start >= 0 && end > start ? DL.slice(start, end) : '';
    assert.ok(handlerBody.includes('if (data.alerts?.length) dispatchOrefBreakingAlert(data.alerts)'));
  });
});
