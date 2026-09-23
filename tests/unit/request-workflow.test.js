/**
 * Unit tests for the maintenance-request workflow (the state machine and the
 * object-level authorisation rules), exercised directly against the service
 * layer with no HTTP in between.
 */
const service = require('../../src/services/requests');
const { repositories } = require('../../src/repositories');
const { seedDatabase } = require('../../src/db');
const { AppError } = require('../../src/middleware/errorHandler');

// Unit tests do not boot the Express app, so seed the schema explicitly.
beforeAll(() => seedDatabase());

const TENANT = { id: 'U1', name: 'Sarah Williams', role: 'tenant' };
const MANAGER = { id: 'U2', name: 'Michael Jacobs', role: 'manager' };
const TECH = { id: 'U9', name: 'Johan van der Merwe', role: 'technician' };
const OTHER_TENANT = { id: 'U5', name: 'Priya Naidoo', role: 'tenant' };
const ADMIN = { id: 'U14', name: 'System Admin', role: 'admin' };

/** Put a request into a known state without going through the workflow. */
function setState(id, status, techId) {
  db_update(id, status, techId);
}

function db_update(id, status, techId) {
  repositories.requests.run(
    'UPDATE requests SET status = ?, tech_id = ? WHERE id = ?',
    status,
    techId === undefined ? null : techId,
    id
  );
}

describe('Request workflow - allowed transitions', () => {
  it('lets a tenant cancel a submitted request but not complete it', () => {
    setState('REQ-1046', 'submitted');
    expect(service.canPerform(TENANT, { status: 'submitted' }, 'cancel')).toBe(true);
    expect(service.canPerform(TENANT, { status: 'submitted' }, 'complete')).toBe(false);
  });

  it('lets a manager assign or approve a submitted request', () => {
    expect(service.canPerform(MANAGER, { status: 'submitted' }, 'assign')).toBe(true);
    expect(service.canPerform(MANAGER, { status: 'submitted' }, 'approve')).toBe(true);
    expect(service.canPerform(MANAGER, { status: 'submitted' }, 'complete')).toBe(false);
  });

  it('follows the technician path assigned -> in-progress -> completed', () => {
    expect(service.canPerform(TECH, { status: 'assigned' }, 'accept')).toBe(true);
    expect(service.canPerform(TECH, { status: 'in-progress' }, 'complete')).toBe(true);
    expect(service.canPerform(TECH, { status: 'in-progress' }, 'accept')).toBe(false);
    expect(service.canPerform(TECH, { status: 'on-hold' }, 'resume')).toBe(true);
  });

  it('never allows an action outside the role table', () => {
    expect(service.canPerform(ADMIN, { status: 'completed' }, 'reopen')).toBe(false);
    expect(service.canPerform(ADMIN, { status: 'completed' }, 'approve')).toBe(false);
  });

  it('treats rating as its own endpoint, not a status action', () => {
    // 'rate' was previously listed in the tenant transition table even though
    // the status endpoint rejects it, which made the table lie about the API.
    expect(service.allowedActions(TENANT, { status: 'completed' })).toEqual(['confirm', 'reopen']);
    expect(service.canPerform(TENANT, { status: 'completed' }, 'rate')).toBe(true);
  });
});

describe('Request workflow - object-level authorisation', () => {
  it('lets a tenant see only their own request', () => {
    const mine = repositories.requests.findById('REQ-1045'); // tenant U1
    expect(service.canView(TENANT, mine)).toBe(true);
    expect(service.canView(OTHER_TENANT, mine)).toBe(false);
  });

  it('lets a manager see requests on the properties they manage', () => {
    const onMyProperty = repositories.requests.findById('REQ-1045'); // P1 -> U2
    const onOtherProperty = repositories.requests.findById('REQ-1027'); // P3 -> U3
    expect(service.canView(MANAGER, onMyProperty)).toBe(true);
    expect(service.canView(MANAGER, onOtherProperty)).toBe(false);
  });

  it('lets a technician see only jobs assigned to them', () => {
    const mine = repositories.requests.findById('REQ-1045'); // T1 -> U9
    const theirs = repositories.requests.findById('REQ-1032'); // T2
    expect(service.canView(TECH, mine)).toBe(true);
    expect(service.canView(TECH, theirs)).toBe(false);
  });

  it('lets an admin see everything', () => {
    expect(service.canView(ADMIN, repositories.requests.findById('REQ-1027'))).toBe(true);
  });

  it('refuses to resolve the technician record for a non-technician', () => {
    const actor = service.resolveActor(TENANT);
    expect(actor.technicianId).toBeNull();
  });

  it('resolves the technician record for a technician user', () => {
    const actor = service.resolveActor(TECH);
    expect(actor.technicianId).toBe('T1');
  });
});

describe('Request workflow - service behaviour', () => {
  it('rejects an unknown request with 404', () => {
    expect(() => service.getDetail(TENANT, 'REQ-0000')).toThrow(AppError);
    try {
      service.getDetail(TENANT, 'REQ-0000');
    } catch (err) {
      expect(err.statusCode).toBe(404);
    }
  });

  it('rejects a cross-tenant read with 403', () => {
    try {
      service.getDetail(OTHER_TENANT, 'REQ-1045');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.statusCode).toBe(403);
    }
  });

  it('blocks a request for a unit the tenant does not occupy', () => {
    expect(() => service.createRequest(TENANT, {
      category: 'plumbing', urgency: 'low', title: 'x', detail: 'y', unit: 'Somebody Elses Unit',
    })).toThrow(/only submit a request for one of your assigned units/);
  });

  it('creates a request, seeds its history and returns the detail', () => {
    const before = repositories.requests.listAll().length;
    const created = service.createRequest(TENANT, {
      category: 'electrical', urgency: 'normal', title: 'Unit test socket', detail: 'Dead socket',
      unit: 'Claremont Unit 1A',
    });

    expect(created.status).toBe('submitted');
    expect(created.propertyId).toBe('P1');
    expect(created.history).toEqual([{ status: 'Submitted', when: expect.any(String) }]);
    expect(repositories.requests.listAll().length).toBe(before + 1);
  });

  it('records a full timestamp in `updated` so same-day ordering survives', () => {
    setState('REQ-1046', 'submitted');
    const updated = service.applyStatusAction(TENANT, 'REQ-1046', 'cancel');
    expect(updated.status).toBe('cancelled');
    expect(updated.updated).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('refuses an illegal transition with 400', () => {
    setState('REQ-1046', 'submitted');
    try {
      service.applyStatusAction(TENANT, 'REQ-1046', 'confirm');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain('not allowed');
    }
  });

  it('refuses a second rating of the same request', () => {
    setState('REQ-1015', 'completed', 'T1');
    service.rateRequest({ id: 'U6', name: 'Zanele Dlamini', role: 'tenant' }, 'REQ-1015', 5);
    expect(() => service.rateRequest(
      { id: 'U6', name: 'Zanele Dlamini', role: 'tenant' }, 'REQ-1015', 4
    )).toThrow(/already been rated/);
  });
});
