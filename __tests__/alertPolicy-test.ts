import {
  ALERT_FUTURE_TOLERANCE_MS,
  ALERT_RELAY_GRACE_MS,
  alertDigest,
  applyAlert,
  isAlertActive,
  isAlertRelayable,
  isValidAlertPayload,
  MAX_ALERT_LIFETIME_MS,
  MAX_ALERTS_PER_AUTHORITY,
  pruneAlerts,
  StoredAlert,
  wantsAlert,
} from '../src/services/mesh/alertPolicy';
import type { AlertPayload } from '../src/services/mesh/packet';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const alert = (overrides: Partial<StoredAlert> = {}): StoredAlert => ({
  origin: 'office-a',
  id: 'a1',
  timestamp: NOW,
  exp: NOW + 6 * HOUR,
  headline: 'Ewakuacja',
  text: 'Punkt zbiórki: szkoła nr 3',
  authority: 'Urząd Miasta',
  certExp: NOW + 30 * 24 * HOUR,
  cancelled: false,
  raw: new Uint8Array([1]),
  ...overrides,
});

const ids = (list: StoredAlert[]) => list.map((a) => `${a.origin}/${a.id}@${a.timestamp}${a.cancelled ? 'x' : ''}`).sort();

describe('alert payload validation', () => {
  const payload = (o: Partial<AlertPayload> = {}): AlertPayload => ({ id: 'a1', h: 'Ewakuacja', t: 'tekst', exp: NOW + HOUR, c: 'cert', ...o });

  it('accepts a normal alert and a cancellation', () => {
    expect(isValidAlertPayload(payload(), NOW)).toBe(true);
    expect(isValidAlertPayload(payload({ x: true, h: '', t: '' }), NOW)).toBe(true);
  });

  it('rejects malformed, overlong and overlived alerts', () => {
    const bad: unknown[] = [
      null,
      payload({ id: '' }),
      payload({ id: 'a b' }),
      payload({ h: '   ' }),
      payload({ h: 'x'.repeat(81) }),
      payload({ t: 'x'.repeat(501) }),
      payload({ exp: NOW }),
      payload({ exp: NOW + MAX_ALERT_LIFETIME_MS + 1 }),
      payload({ exp: Infinity }),
      payload({ exp: NaN }),
      payload({ exp: 1.5 }),
      { ...payload(), x: false },
      { ...payload(), x: 'yes' },
      { ...payload(), c: undefined },
      { ...payload(), h: 5 },
    ];
    for (const b of bad) expect(isValidAlertPayload(b as AlertPayload, NOW)).toBe(false);
  });
});

describe('alert store rules', () => {
  it('lets the newer signed version win, whatever the arrival order', () => {
    const v1 = alert({ headline: 'Stary', timestamp: NOW });
    const v2 = alert({ headline: 'Nowy', timestamp: NOW + 1 });
    expect(applyAlert(applyAlert([], v1), v2)[0].headline).toBe('Nowy');
    const reversed = applyAlert([], v2);
    expect(applyAlert(reversed, v1)).toBe(reversed); // same list object = nothing changed
    expect(wantsAlert(reversed, v1)).toBe(false);
  });

  it('treats an identical version as a duplicate', () => {
    const list = applyAlert([], alert());
    expect(applyAlert(list, alert())).toBe(list);
  });

  it('lets a cancellation win a timestamp tie', () => {
    const list = applyAlert([], alert());
    const cancelled = applyAlert(list, alert({ cancelled: true }));
    expect(cancelled[0].cancelled).toBe(true);
    expect(applyAlert(cancelled, alert())).toBe(cancelled);
  });

  it('does not let the original packet resurrect a cancelled alert', () => {
    const original = alert({ timestamp: NOW });
    const tombstone = alert({ timestamp: NOW + 1, cancelled: true });
    const list = applyAlert(applyAlert([], original), tombstone);
    expect(applyAlert(list, original)).toBe(list);
    // …including on a node that only ever saw the tombstone.
    const onlyTombstone = applyAlert([], tombstone);
    expect(applyAlert(onlyTombstone, original)).toBe(onlyTombstone);
    expect(isAlertActive(onlyTombstone[0], NOW + 2)).toBe(false);
  });

  it('keeps only the newest alerts of one authority, independent of arrival order', () => {
    const all = Array.from({ length: MAX_ALERTS_PER_AUTHORITY + 3 }, (_, i) => alert({ id: `a${i}`, timestamp: NOW + i }));
    const forward = all.reduce(applyAlert, [] as StoredAlert[]);
    const backward = [...all].reverse().reduce(applyAlert, [] as StoredAlert[]);
    const shuffled = [all[4], all[0], all[7], all[2], all[6], all[1], all[5], all[3]].reduce(applyAlert, [] as StoredAlert[]);
    expect(forward).toHaveLength(MAX_ALERTS_PER_AUTHORITY);
    expect(ids(forward)).toEqual(ids(all.slice(3)));
    expect(ids(backward)).toEqual(ids(forward));
    expect(ids(shuffled)).toEqual(ids(forward));
    expect(alertDigest(backward)).toBe(alertDigest(forward));
  });

  it('never lets one authority push out another authority\'s alerts', () => {
    let list = applyAlert([], alert({ origin: 'office-b', id: 'b1', timestamp: NOW - 5 * HOUR }));
    for (let i = 0; i < 20; i++) list = applyAlert(list, alert({ id: `flood${i}`, timestamp: NOW + i }));
    expect(list.filter((a) => a.origin === 'office-a')).toHaveLength(MAX_ALERTS_PER_AUTHORITY);
    expect(list.some((a) => a.origin === 'office-b' && a.id === 'b1')).toBe(true);
  });

  it('refuses an alert older than everything already kept for a full authority', () => {
    const full = Array.from({ length: MAX_ALERTS_PER_AUTHORITY }, (_, i) => alert({ id: `a${i}`, timestamp: NOW + i })).reduce(applyAlert, [] as StoredAlert[]);
    const old = alert({ id: 'old', timestamp: NOW - 1 });
    expect(wantsAlert(full, old)).toBe(false);
    expect(applyAlert(full, old)).toBe(full);
  });
});

describe('alert lifetime', () => {
  it('is strict about what is displayed', () => {
    const a = alert();
    expect(isAlertActive(a, NOW)).toBe(true);
    expect(isAlertActive(a, a.exp)).toBe(true);
    expect(isAlertActive(a, a.exp + 1)).toBe(false);
    expect(isAlertActive(alert({ cancelled: true }), NOW)).toBe(false);
    // The certificate expiring ends the alert early.
    expect(isAlertActive(alert({ certExp: NOW + HOUR }), NOW + HOUR + 1)).toBe(false);
    // An alert stamped far in the future is not shown yet.
    expect(isAlertActive(alert({ timestamp: NOW + ALERT_FUTURE_TOLERANCE_MS + 1, exp: NOW + 20 * HOUR }), NOW)).toBe(false);
  });

  it('is lenient about what is stored and passed on', () => {
    const a = alert();
    expect(isAlertRelayable(a, a.exp + ALERT_RELAY_GRACE_MS)).toBe(true);
    expect(isAlertRelayable(a, a.exp + ALERT_RELAY_GRACE_MS + 1)).toBe(false);
    const list = [a, alert({ id: 'a2', exp: NOW + 100 * HOUR })];
    expect(pruneAlerts(list, NOW)).toBe(list);
    expect(pruneAlerts(list, a.exp + ALERT_RELAY_GRACE_MS + 1).map((x) => x.id)).toEqual(['a2']);
  });

  it('summarises the set in a digest that changes with any version change', () => {
    const base = [alert(), alert({ origin: 'office-b', id: 'b1' })];
    expect(alertDigest(base)).toBe(alertDigest([...base].reverse()));
    expect(alertDigest(base)).toMatch(/^[0-9a-f]{16}$/);
    expect(alertDigest(base)).not.toBe(alertDigest([base[0]]));
    expect(alertDigest(base)).not.toBe(alertDigest([alert({ timestamp: NOW + 1 }), base[1]]));
    expect(alertDigest(base)).not.toBe(alertDigest([alert({ cancelled: true }), base[1]]));
  });
});
