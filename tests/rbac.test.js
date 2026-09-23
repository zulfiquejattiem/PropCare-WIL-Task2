const request = require('supertest');
const app = require('../src/app');

const PASSWORD = 'PropCare123!';

async function login(email) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD });
  return res.body.data.token;
}

describe('RBAC - unauthenticated access', () => {
  it('blocks requests access without a token', async () => {
    const res = await request(app).get('/api/requests');
    expect(res.status).toBe(401);
  });

  it('blocks notifications access without a token', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  it('blocks reference data without a token', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(401);
  });
});

describe('RBAC - admin-only endpoints', () => {
  it('allows the admin to list all users', async () => {
    const token = await login('admin@obsrealty.co.za');
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.users.length).toBe(14);
  });

  it('allows the admin to create a user', async () => {
    const token = await login('admin@obsrealty.co.za');
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Tenant',
        email: 'new.tenant@example.com',
        password: 'StrongPass1!',
        role: 'tenant',
        propertyId: 'P1',
        unit: 'Claremont Unit 9C',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('new.tenant@example.com');
    // A tenant is attached to their unit at creation time so they can raise
    // requests immediately (see the bug report: previously this was impossible).
    expect(res.body.data.user.units).toContain('Claremont Unit 9C');
  });

  it('creates a technician with a trade record so it can be assigned work', async () => {
    const token = await login('admin@obsrealty.co.za');
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Technician',
        email: 'new.technician@example.com',
        password: 'StrongPass1!',
        role: 'technician',
        skill: 'Plumbing',
      });

    expect(res.status).toBe(201);

    const techs = await request(app)
      .get('/api/technicians')
      .set('Authorization', `Bearer ${token}`);
    expect(techs.body.data.technicians.some((t) => t.email === 'new.technician@example.com')).toBe(true);
  });

  it('rejects a tenant creation with no unit assignment', async () => {
    const token = await login('admin@obsrealty.co.za');
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Homeless Tenant',
        email: 'no.unit@example.com',
        password: 'StrongPass1!',
        role: 'tenant',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('property and unit');
  });

  it('rejects a duplicate user email with 409', async () => {
    const token = await login('admin@obsrealty.co.za');
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Copy',
        email: 'new.tenant@example.com',
        password: 'StrongPass1!',
        role: 'tenant',
        propertyId: 'P1',
        unit: 'Claremont Unit 9C',
      });

    expect(res.status).toBe(409);
  });

  it('rejects a manager from listing users', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('rejects a tenant from listing users', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

describe('RBAC - technician directory', () => {
  it('lists technicians for managers', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');
    const res = await request(app)
      .get('/api/technicians')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Five technicians are seeded; the admin may have created more earlier in
    // this suite, so assert on the seeded set rather than an exact count.
    expect(res.body.data.technicians.length).toBeGreaterThanOrEqual(5);
    expect(res.body.data.technicians[0]).toHaveProperty('skill');
    expect(res.body.data.technicians.some((t) => t.id === 'T1')).toBe(true);
  });

  it('lists technicians for admins', async () => {
    const token = await login('admin@obsrealty.co.za');
    const res = await request(app)
      .get('/api/technicians')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('rejects a tenant from listing technicians', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .get('/api/technicians')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

describe('RBAC - tenant directory', () => {
  it('lists tenants for managers', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');
    const res = await request(app)
      .get('/api/tenants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Seeded tenants plus any created earlier in the suite (shared in-memory DB).
    expect(res.body.data.tenants.length).toBeGreaterThanOrEqual(6);
    expect(res.body.data.tenants.some((t) => t.email === 'sarahwilliams@example.com')).toBe(true);
  });

  it('rejects a technician from listing tenants', async () => {
    const token = await login('johan.vdm@obsrealty.co.za');
    const res = await request(app)
      .get('/api/tenants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

describe('RBAC - properties', () => {
  it('scopes properties to the manager portfolio', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');
    const res = await request(app)
      .get('/api/properties')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.properties.length).toBe(6);
  });

  it('scopes properties for Ayesha to her own portfolio', async () => {
    const token = await login('ayesha.patel@obsrealty.co.za');
    const res = await request(app)
      .get('/api/properties')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.properties.length).toBe(4);
  });

  it('lists all properties for an admin', async () => {
    const token = await login('admin@obsrealty.co.za');
    const res = await request(app)
      .get('/api/properties')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.properties.length).toBe(10);
  });

  it('blocks a manager from viewing another manager property detail', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');
    const res = await request(app)
      .get('/api/properties/P7')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown property', async () => {
    const token = await login('admin@obsrealty.co.za');
    const res = await request(app)
      .get('/api/properties/P99')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('RBAC - object-level request access', () => {
  it('blocks a tenant from viewing another tenant request', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .get('/api/requests/REQ-1032')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('blocks a technician from viewing another technician job', async () => {
    const token = await login('johan.vdm@obsrealty.co.za');
    const res = await request(app)
      .get('/api/requests/REQ-1061')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('blocks a manager from viewing a request outside their portfolio', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');
    // REQ-1079 lives on P7 (Durbanville), managed by Ayesha (U3).
    const res = await request(app)
      .get('/api/requests/REQ-1079')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('blocks a manager from assigning a request outside their portfolio', async () => {
    const token = await login('michael.jacobs@obsrealty.co.za');
    const res = await request(app)
      .post('/api/requests/REQ-1079/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: 'T1', urgency: 'normal' });

    expect(res.status).toBe(403);
  });

  it('blocks a tenant from assigning any request', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .post('/api/requests/REQ-1046/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: 'T1', urgency: 'normal' });

    expect(res.status).toBe(403);
  });

  it('blocks a technician from cancelling a job', async () => {
    const token = await login('johan.vdm@obsrealty.co.za');
    const res = await request(app)
      .post('/api/requests/REQ-1045/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'cancel' });

    expect(res.status).toBe(400);
  });
});

describe('RBAC - profile endpoints', () => {
  it('lets a user update their own name', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sarah W' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe('Sarah W');
  });

  it('rejects a duplicate email update', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'michael.jacobs@obsrealty.co.za' });

    expect(res.status).toBe(409);
  });

  it('blocks the admin from deactivating their own account', async () => {
    const token = await login('admin@obsrealty.co.za');
    const res = await request(app)
      .put('/api/users/U14/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ active: false });

    expect(res.status).toBe(400);
  });

  it('blocks a tenant from deactivating users', async () => {
    const token = await login('sarahwilliams@example.com');
    const res = await request(app)
      .put('/api/users/U9/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ active: false });

    expect(res.status).toBe(403);
  });
});

describe('RBAC - admin deactivation', () => {
  it('deactivates then rejects login for a user', async () => {
    const adminToken = await login('admin@obsrealty.co.za');

    const created = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Temp User',
        email: 'temp.user@example.com',
        password: 'TempPass1!',
        role: 'tenant',
        propertyId: 'P1',
        unit: 'Claremont Unit 8A',
      });
    const userId = created.body.data.user.id;

    const deactivate = await request(app)
      .put(`/api/users/${userId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });
    expect(deactivate.status).toBe(200);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'temp.user@example.com', password: 'TempPass1!' });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('deactivated');
  });
});