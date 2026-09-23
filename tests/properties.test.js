const request = require('supertest');
const app = require('../src/app');

const PASSWORD = 'PropCare123!';


async function login(email) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email,
      password: PASSWORD,
    });


  expect(res.status).toBe(200);


  return res.body.data.token;
}


describe('Property access', () => {
  it('lists only properties containing jobs assigned to the technician', async () => {
    const token = await login('johan.vdm@obsrealty.co.za');


    const res = await request(app)
      .get('/api/properties')
      .set('Authorization', `Bearer ${token}`);


    expect(res.status).toBe(200);


    const properties = res.body.data.properties;
    const ids = properties.map((property) => property.id);


    // Johan is U9 and technician T1.
    // Current seed assigns T1 jobs on P1 and P5.
    expect(new Set(ids)).toEqual(
      new Set(['P1', 'P5'])
    );
  });


  it('does not expose unrelated properties to the technician', async () => {
    const token = await login('johan.vdm@obsrealty.co.za');


    const res = await request(app)
      .get('/api/properties')
      .set('Authorization', `Bearer ${token}`);


    expect(res.status).toBe(200);


    const ids = res.body.data.properties.map(
      (property) => property.id
    );


    expect(ids).not.toContain('P3');
    expect(ids).not.toContain('P7');
    expect(ids).not.toContain('P8');
    expect(ids).not.toContain('P9');
  });
});