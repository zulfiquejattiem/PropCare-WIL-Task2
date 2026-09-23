/**
 * Unit tests for the Repository layer.
 *
 * These run against the real (in-memory) database but below the HTTP layer, so
 * they pin down the data-access contract: scoping, id allocation and the
 * aggregate queries.
 */
const { repositories } = require('../../src/repositories');
const { db, seedDatabase } = require('../../src/db');

// Unit tests do not boot the Express app, so seed the schema explicitly.
beforeAll(() => seedDatabase());

describe('RequestRepository - id allocation', () => {
  // These tests insert rows, so clean them up - the scoping assertions below
  // depend on the seeded dataset being intact.
  afterAll(() => {
    db.prepare("DELETE FROM requests WHERE id IN ('REQ-999','REQ-1080','REQ-1081','REQ-2000','REQ-2001')").run();
  });

  it('allocates ids in numeric order, not lexicographic order', () => {
    // Regression: `MAX(id)` on a TEXT column compares strings, so a legacy
    // REQ-999 outranked REQ-1000+ and the next insert collided (HTTP 500).
    db.prepare(
      `INSERT INTO requests (id, property_id, unit, tenant_id, category, title, detail, urgency, status, tech_id, created, updated, photos)
       VALUES ('REQ-999','P1','u','U1','plumbing','legacy','d','low','closed',NULL,'2020-01-01','2020-01-01',0)`
    ).run();

    expect(repositories.requests.nextNumber()).toBe(1080);

    const first = repositories.requests.allocateId();
    repositories.requests.insert({
      id: first, propertyId: 'P1', unit: 'u', tenantId: 'U1', category: 'plumbing',
      title: 'a', detail: 'b', urgency: 'low', created: '2026-01-01', updated: '2026-01-01',
    });
    expect(first).toBe('REQ-1080');

    // The next allocation must not repeat REQ-1080.
    const second = repositories.requests.allocateId();
    expect(second).toBe('REQ-1081');
  });

  it('skips ids that are already taken', () => {
    db.prepare(
      `INSERT INTO requests (id, property_id, unit, tenant_id, category, title, detail, urgency, status, tech_id, created, updated, photos)
       VALUES ('REQ-2000','P1','u','U1','plumbing','gap','d','low','closed',NULL,'2020-01-01','2020-01-01',0)`
    ).run();
    db.prepare(
      `INSERT INTO requests (id, property_id, unit, tenant_id, category, title, detail, urgency, status, tech_id, created, updated, photos)
       VALUES ('REQ-2001','P1','u','U1','plumbing','gap','d','low','closed',NULL,'2020-01-01','2020-01-01',0)`
    ).run();

    const next = repositories.requests.allocateId();
    expect(next).toBe('REQ-2002');
  });
});

describe('UserRepository', () => {
  it('allocates the next free user id rather than deriving it from the row count', () => {
    // Seeded users are U1..U14, so the next id must be U15 - not U115, which is
    // what the old "row count + 100" scheme produced.
    expect(repositories.users.nextId()).toBe('U15');
  });

  it('lowercases emails on lookup so login is case-insensitive', () => {
    expect(repositories.users.findByEmail('SARAHWILLIAMS@EXAMPLE.COM')).toBeTruthy();
    expect(repositories.users.findByEmail('sarahwilliams@example.com')).toBeTruthy();
  });

  it('never exposes the password hash through the public finder', () => {
    const user = repositories.users.findById('U1');
    expect(user).toBeTruthy();
    expect(user).not.toHaveProperty('password_hash');
    // ...but the auth layer can still get it.
    expect(repositories.users.findByIdFull('U1')).toHaveProperty('password_hash');
  });

  it('caches prepared statements between calls', () => {
    const before = repositories.users._statements.size;
    repositories.users.findById('U1');
    repositories.users.findById('U1');
    expect(repositories.users._statements.size).toBe(before);
  });
});

describe('RequestRepository - authorisation scoping', () => {
  it('scopes totals to a manager portfolio', () => {
    const totals = repositories.requests.totals({ role: 'manager', id: 'U2' });
    // Michael manages P1, P2, P4, P6, P8, P10 -> 8 seeded requests.
    expect(totals.total).toBe(8);
    expect(totals.open).toBe(7);
    expect(totals.resolved).toBe(1);
  });

  it('scopes totals to a tenant', () => {
    const totals = repositories.requests.totals({ role: 'tenant', id: 'U1' });
    expect(totals.total).toBe(4);
  });

  it('returns nothing for a technician with no technician record', () => {
    const actor = { role: 'technician', id: 'U99', technicianId: null };
    expect(repositories.requests.totals(actor).total).toBe(0);
  });

  it('counts categories within the caller scope only', () => {
    const mine = repositories.requests.countByCategory({ role: 'tenant', id: 'U1' });
    expect(mine.find((c) => c.id === 'plumbing').n).toBe(2);

    const all = repositories.requests.countByCategory({ role: 'admin', id: 'U14' });
    expect(all.find((c) => c.id === 'plumbing').n).toBe(4);
  });
});

describe('PropertyRepository - open vs total request counts', () => {
  it('counts only open requests for openCountFor', () => {
    // P8's only request (REQ-1009) is closed, so it has 0 open requests even
    // though it has 1 request in total.
    expect(repositories.properties.openCountFor('P8')).toBe(0);
    // P1 has three requests, all still open.
    expect(repositories.properties.openCountFor('P1')).toBe(3);
  });

  it('can report totals as well as open counts', () => {
    const totals = repositories.properties.requestCounts({});
    const open = repositories.properties.requestCounts({ openOnly: true });
    expect(totals.find((p) => p.id === 'P8').n).toBe(1);
    expect(open.find((p) => p.id === 'P8').n).toBe(0);
  });
});

describe('AuditRepository', () => {
  it('clamps the limit so a client cannot dump the whole table', () => {
    repositories.audit.record({
      actorId: 'U14', actorName: 'System Admin', action: 'test.action',
      entityType: 'request', entityId: 'REQ-1', detail: null, createdAt: '2026-01-01 00:00',
    });
    expect(repositories.audit.recent(0).length).toBeGreaterThan(0);
    expect(repositories.audit.recent(99999).length).toBeLessThanOrEqual(500);
    expect(repositories.audit.recent('not-a-number').length).toBeLessThanOrEqual(500);
  });
});
