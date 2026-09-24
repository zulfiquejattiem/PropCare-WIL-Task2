/**
 * Regression tests for two API defects.
 *
 *   1. `GET /api/requests?status=all` returned HTTP 400 "Invalid status filter"
 *      even though the route handler explicitly branches on `status !== 'all'`.
 *      The validator did not list the `all` sentinel, so the documented
 *      "no filter" contract was unreachable for any client other than the SPA
 *      (which strips `all` before sending).
 *   2. `GET /api/reports/summary` issued the *same* `requestCounts()` query
 *      twice for a manager - once for `byProperty`, once for `portfolio`.
 */
const request = require('supertest');
const app = require('../src/app');
const { repositories } = require('../src/repositories');

const PASSWORD = 'PropCare123!';

async function login(email) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD });
  return res.body.data.token;
}

describe('Request list filters accept the "all" sentinel', () => {
  let token;
  let unfilteredCount;

  beforeAll(async () => {
    token = await login('admin@obsrealty.co.za');
    const all = await request(app)
      .get('/api/requests')
      .set('Authorization', `Bearer ${token}`);
    unfilteredCount = all.body.data.requests.length;
  });

  it('treats ?status=all as "no status filter"', async () => {
    const res = await request(app)
      .get('/api/requests?status=all')
      .set('Authorization', `Bearer ${token}`);

    // Before the fix this was HTTP 400 "Invalid status filter".
    expect(res.status).toBe(200);
    expect(res.body.data.requests).toHaveLength(unfilteredCount);
  });

  it('treats ?category=all as "no category filter"', async () => {
    const res = await request(app)
      .get('/api/requests?category=all')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requests).toHaveLength(unfilteredCount);
  });

  it('accepts both sentinels together', async () => {
    const res = await request(app)
      .get('/api/requests?status=all&category=all')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requests).toHaveLength(unfilteredCount);
  });

  it('still rejects a genuinely invalid status', async () => {
    const res = await request(app)
      .get('/api/requests?status=bogus')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid status filter/);
  });

  it('still rejects a genuinely invalid category', async () => {
    const res = await request(app)
      .get('/api/requests?category=bogus')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid category filter/);
  });

  it('still filters when a real status is supplied', async () => {
    const res = await request(app)
      .get('/api/requests?status=submitted')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requests.length).toBeGreaterThan(0);
    expect(res.body.data.requests.length).toBeLessThan(unfilteredCount);
    expect(res.body.data.requests.every((r) => r.status === 'submitted')).toBe(true);
  });
});

describe('Reports summary does not query property counts twice', () => {
  /** Wrap `requestCounts` for the duration of `fn`, returning the call args. */
  async function captureRequestCounts(fn) {
    const original = repositories.properties.requestCounts;
    const calls = [];
    repositories.properties.requestCounts = function (opts) {
      calls.push(JSON.stringify(opts || {}));
      return original.call(this, opts);
    };
    try {
      await fn();
    } finally {
      repositories.properties.requestCounts = original;
    }
    return calls;
  }

  it('issues exactly one requestCounts() query for a manager', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');

    const calls = await captureRequestCounts(async () => {
      const res = await request(app)
        .get('/api/reports/summary')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.summary.portfolio)).toBe(true);
      expect(Array.isArray(res.body.data.summary.byProperty)).toBe(true);
      // The internal hand-off between buildSummary and the route must not leak.
      expect(res.body.data.summary).not.toHaveProperty('_propertyRows');
    });

    // Before the fix this was 2 identical calls.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('"openOnly":true');
  });

  it('keeps zero-count properties in portfolio but drops them from byProperty', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');

    const res = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', `Bearer ${token}`);

    const { portfolio, byProperty } = res.body.data.summary;

    // Michael manages six properties; P8 (Milnerton Sands) has no open requests
    // in the seed data, so it appears in the portfolio but not in byProperty.
    expect(portfolio).toHaveLength(6);
    expect(portfolio.some((p) => p.id === 'P8' && p.count === 0)).toBe(true);

    expect(byProperty.every((p) => p.count > 0)).toBe(true);
    expect(byProperty).toHaveLength(portfolio.filter((p) => p.count > 0).length);

    // byProperty is the sorted view of the same numbers.
    const sum = (rows) => rows.reduce((acc, p) => acc + p.count, 0);
    expect(sum(byProperty)).toBe(sum(portfolio));
    for (let i = 1; i < byProperty.length; i += 1) {
      expect(byProperty[i - 1].count).toBeGreaterThanOrEqual(byProperty[i].count);
    }
  });

  it('returns the same shape for an admin without the internal key', async () => {
    const token = await login('admin@obsrealty.co.za');

    const calls = await captureRequestCounts(async () => {
      const res = await request(app)
        .get('/api/reports/summary')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const summary = res.body.data.summary;
      expect(summary).not.toHaveProperty('_propertyRows');
      expect(summary).not.toHaveProperty('portfolio');
      expect(summary.properties).toEqual(expect.any(Number));
      expect(summary.users).toBeDefined();
    });

    expect(calls).toHaveLength(1);
  });
});
