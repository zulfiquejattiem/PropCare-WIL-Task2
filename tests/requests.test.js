const request = require('supertest');
const app = require('../src/app');

const PASSWORD = 'PropCare123!';

async function login(email) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD });
  return res.body.data.token;
}

describe('Requests API - GET /api/requests (role scoping)', () => {
  it('lists all requests for an admin', async () => {
    const token = await login('admin@obsrealty.co.za');
    const res = await request(app)
      .get('/api/requests')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.requests.length).toBe(12);
  });

  it('lists only managed-property requests for a manager', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');
    const res = await request(app)
      .get('/api/requests')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requests.length).toBe(8);
  });

  it('lists only own requests for a tenant', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .get('/api/requests')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.requests.map((r) => r.id);
    expect(ids).toContain('REQ-1045');
    expect(ids).not.toContain('REQ-1032');
  });

  it('lists only assigned jobs for a technician', async () => {
    const token = await login('johan.vdm@obsrealty.co.za');
    const res = await request(app)
      .get('/api/requests')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.requests.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['REQ-1045', 'REQ-1015']));
    expect(ids).not.toContain('REQ-1032');
  });

  it('filters by status for a manager', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');
    const res = await request(app)
      .get('/api/requests?status=completed')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requests.every((r) => r.status === 'completed')).toBe(true);
  });

  it('rejects an invalid status filter', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');
    const res = await request(app)
      .get('/api/requests?status=banana')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

describe('Requests API - GET /api/requests/:id', () => {
  it('returns a request with comments, history and rating for the owner', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .get('/api/requests/REQ-1045')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const r = res.body.data.request;
    expect(r.id).toBe('REQ-1045');
    expect(r.propertyName).toBe('Oak Avenue Residences');
    expect(r.categoryName).toBe('Plumbing');
    expect(r.status).toBe('in-progress');
    expect(r.comments.length).toBe(3);
    expect(r.history.length).toBeGreaterThanOrEqual(4);
  });
it('returns the seeded rating on a completed request', async () => {
  const token = await login('priya.naidoo@example.com');


  const res = await request(app)
    .get('/api/requests/REQ-1027')
    .set('Authorization', `Bearer ${token}`);


  expect(res.status).toBe(200);
  expect(res.body.data.request.rating).toBe(5);
});

  it('returns 404 for an unknown request id', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .get('/api/requests/REQ-9999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('Requests API - POST /api/requests (tenant create)', () => {
  it('creates a new request and notifies the manager', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        category: 'plumbing',
        unit: 'Claremont Unit 3B',
        title: 'Burst pipe under kitchen sink',
        detail: 'Water leaking from the supply pipe under the sink.',
        urgency: 'high',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    const r = res.body.data.request;
    expect(r.id).toMatch(/^REQ-\d+$/);
    expect(r.status).toBe('submitted');
    expect(r.categoryName).toBe('Plumbing');
    expect(r.tenantName).toBe('Sarah Williams');
  });

  it('rejects creation from a non-tenant role', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        category: 'plumbing',
        unit: 'Claremont Unit 3B',
        title: 'Not allowed',
        detail: 'Managers cannot file requests.',
        urgency: 'low',
      });

    expect(res.status).toBe(403);
  });

  it('rejects an invalid category', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        category: 'gardening',
        unit: 'Claremont Unit 3B',
        title: 'Garden',
        detail: 'x',
        urgency: 'low',
      });

    expect(res.status).toBe(400);
  });

  it('rejects a missing title', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        category: 'plumbing',
        unit: 'Claremont Unit 3B',
        title: '   ',
        detail: 'x',
        urgency: 'low',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('title');
  });
});

describe('Requests API - full lifecycle (submit -> assign -> accept -> complete -> confirm -> rate)', () => {
  let tenantToken;
  let managerToken;
  let techToken;
  let createdId;

  beforeAll(async () => {
    tenantToken = await login('sarahwilliams@example.com');
    managerToken = await login('michael.jacobs@obsrealty.co.za');
    techToken = await login('johan.vdm@obsrealty.co.za');

    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tenantToken}`)
      .send({
        category: 'appliances',
        unit: 'Claremont Unit 3B',
        title: 'Washing machine leaking',
        detail: 'Water leaks from the washing machine door seal.',
        urgency: 'normal',
      });
    createdId = created.body.data.request.id;
  });

  it('logs the correct history as the request moves through states', async () => {
    expect(createdId).toMatch(/^REQ-\d+$/);

    const assign = await request(app)
      .post(`/api/requests/${createdId}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ technicianId: 'T1', urgency: 'high' });
    expect(assign.status).toBe(200);
    expect(assign.body.data.request.status).toBe('assigned');
    expect(assign.body.data.request.technicianName).toBe('Johan van der Merwe');

    const accept = await request(app)
      .post(`/api/requests/${createdId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ action: 'accept' });
    expect(accept.status).toBe(200);
    expect(accept.body.data.request.status).toBe('in-progress');

    const complete = await request(app)
      .post(`/api/requests/${createdId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ action: 'complete', text: 'Replaced the door seal and tested.' });
    expect(complete.status).toBe(200);
    expect(complete.body.data.request.status).toBe('completed');

    const confirm = await request(app)
      .post(`/api/requests/${createdId}/status`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .send({ action: 'confirm' });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.request.status).toBe('closed');

    const detail = await request(app)
      .get(`/api/requests/${createdId}`)
      .set('Authorization', `Bearer ${tenantToken}`);
    const statuses = detail.body.data.request.history.map((h) => h.status);
    expect(statuses).toEqual([
      'Submitted',
      'Assigned',
      'In progress',
      'Completed',
      'Closed',
    ]);
    expect(detail.body.data.request.comments.length).toBe(4);
  });

  it('rejects an invalid transition (confirm on a submitted request)', async () => {
    const res = await request(app)
      .post('/api/requests/REQ-1046/status')
      .set('Authorization', `Bearer ${tenantToken}`)
      .send({ action: 'confirm' });

    expect(res.status).toBe(400);
  });

  it('rejects completing a job that is not in-progress', async () => {
    const res = await request(app)
      .post('/api/requests/REQ-1015/status')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ action: 'complete' });

    expect(res.status).toBe(400);
  });

  it('allows a tenant to cancel their own submitted request', async () => {
    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${await login('thabo.nkosi@example.com')}`)
      .send({
        category: 'security',
        unit: 'Rondebosch Unit 7',
        title: 'Loose security gate panel',
        detail: 'The gate panel rattles loudly in the wind.',
        urgency: 'low',
      });
    const id = created.body.data.request.id;

    const res = await request(app)
      .post(`/api/requests/${id}/status`)
      .set('Authorization', `Bearer ${await login('thabo.nkosi@example.com')}`)
      .send({ action: 'cancel' });

    expect(res.status).toBe(200);
    expect(res.body.data.request.status).toBe('cancelled');
  });
});

describe('Requests API - comments, photos and rating', () => {
  it('adds a comment to a visible request', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .post('/api/requests/REQ-1061/comments')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Can you confirm the inspection time?' });

    expect(res.status).toBe(200);
    const comments = res.body.data.request.comments;
    expect(comments[comments.length - 1].text).toBe('Can you confirm the inspection time?');
  });

  it('rejects an empty comment', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .post('/api/requests/REQ-1061/comments')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: '   ' });

    expect(res.status).toBe(400);
  });

  it('lets a tenant attach a photo to their request', async () => {
    const token = await login('sarahwilliams@example.com');
    const before = await request(app)
      .get('/api/requests/REQ-1061')
      .set('Authorization', `Bearer ${token}`);
    const photosBefore = before.body.data.request.photos;

    const res = await request(app)
      .post('/api/requests/REQ-1061/photos')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.request.photos).toBe(photosBefore + 1);
  });

it('rejects rating a request that is not completed', async () => {
    const token = await login('sarahwilliams@example.com');


    const res = await request(app)
      .post('/api/requests/REQ-1045/rate')
      .set('Authorization', `Bearer ${token}`)
      .send({ stars: 4 });


    expect(res.status).toBe(400);
    expect(res.body.message).toContain('completed');
});

  it('rejects an out-of-range star rating', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .post('/api/requests/REQ-1045/rate')
      .set('Authorization', `Bearer ${token}`)
      .send({ stars: 9 });

    expect(res.status).toBe(400);
  });

  it('rates only the requesting tenant on a completed request', async () => {
    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${await login('zanele.dlamini@example.com')}`)
      .send({
        category: 'electrical',
        unit: 'Bellville Unit 9',
        title: 'Tripping breaker',
        detail: 'The kitchen breaker trips whenever the kettle is on.',
        urgency: 'high',
      });
    const id = created.body.data.request.id;

    // Zanele's default property (Bellville, P5) is managed by Ayesha (U3).
    const ayeshaToken = await login('ayesha.patel@obsrealty.co.za');
    const assign = await request(app)
      .post(`/api/requests/${id}/assign`)
      .set('Authorization', `Bearer ${ayeshaToken}`)
      .send({ technicianId: 'T2', urgency: 'high' });
    expect(assign.status).toBe(200);

    await request(app)
      .post(`/api/requests/${id}/status`)
      .set('Authorization', `Bearer ${await login('riaan.botha@obsrealty.co.za')}`)
      .send({ action: 'accept' });

    await request(app)
      .post(`/api/requests/${id}/status`)
      .set('Authorization', `Bearer ${await login('riaan.botha@obsrealty.co.za')}`)
      .send({ action: 'complete' });

    const res = await request(app)
      .post(`/api/requests/${id}/rate`)
      .set('Authorization', `Bearer ${await login('zanele.dlamini@example.com')}`)
      .send({ stars: 5 });

    expect(res.status).toBe(200);
    expect(res.body.data.request.rating).toBe(5);
  });
});

describe('Notifications API', () => {
  it('returns the current user feed with an unread count', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.unread).toBe(res.body.data.notifications.length);
    // A seeded notification should still be present.
    expect(res.body.data.notifications.some((n) => n.title.includes('REQ-1045'))).toBe(true);
  });

  it('marks all notifications as read', async () => {
    const token = await login('sarahwilliams@example.com');
    await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.unread).toBe(0);
  });
});
