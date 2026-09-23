/**
 * RequestRepository - maintenance requests plus their comments, status history
 * and ratings, and the aggregate counts behind the reports screens.
 */
const { BaseRepository } = require('./base.repository');
const { OPEN_STATUSES, RESOLVED_STATUSES } = require('../db');

const LIST_COLUMNS = `
  r.id, r.title, r.detail, r.category, r.urgency, r.status, r.unit, r.created,
  r.updated, r.photos, r.tech_id, c.name AS category_name, r.property_id,
  p.name AS property_name`;

function inList(values) {
  return values.map((v) => `'${v}'`).join(', ');
}

class RequestRepository extends BaseRepository {
  /* ---------------- reads ---------------- */

  findById(id) {
    return this.get(
      `SELECT r.*, c.name AS category_name, u.name AS tenant_name, p.name AS property_name,
              tu.name AS technician_name, tech.skill AS technician_skill
       FROM requests r
       JOIN categories c ON c.id = r.category
       JOIN users u ON u.id = r.tenant_id
       JOIN properties p ON p.id = r.property_id
       LEFT JOIN technicians tech ON tech.id = r.tech_id
       LEFT JOIN users tu ON tu.id = tech.user_id
       WHERE r.id = ?`,
      id
    );
  }

  forTenant(tenantId) {
    return this.all(
      `SELECT ${LIST_COLUMNS}
       FROM requests r
       JOIN categories c ON c.id = r.category
       JOIN properties p ON p.id = r.property_id
       WHERE r.tenant_id = ? ORDER BY r.updated DESC`,
      tenantId
    );
  }

  forTechnician(technicianId) {
    return this.all(
      `SELECT ${LIST_COLUMNS}
       FROM requests r
       JOIN categories c ON c.id = r.category
       JOIN properties p ON p.id = r.property_id
       WHERE r.tech_id = ? ORDER BY r.updated DESC`,
      technicianId
    );
  }

  forManager(managerId) {
    return this.all(
      `SELECT ${LIST_COLUMNS}
       FROM requests r
       JOIN categories c ON c.id = r.category
       JOIN properties p ON p.id = r.property_id
       WHERE p.manager_id = ? ORDER BY r.updated DESC`,
      managerId
    );
  }

  listAll() {
    return this.all(
      `SELECT ${LIST_COLUMNS}
       FROM requests r
       JOIN categories c ON c.id = r.category
       JOIN properties p ON p.id = r.property_id
       ORDER BY r.updated DESC`
    );
  }

  /* ---------------- writes ---------------- */

  /**
   * Allocate the next `REQ-<n>` id.
   *
   * `MAX()` is applied to the *numeric* part: the id column is TEXT, so
   * `MAX(id)` would compare lexicographically and REQ-999 would outrank
   * REQ-1000, which previously produced duplicate ids and HTTP 500s.
   */
  nextNumber() {
    const row = this.get(
      `SELECT COALESCE(MAX(CAST(REPLACE(id, 'REQ-', '') AS INTEGER)), 1079) AS n FROM requests`
    );
    return (row && row.n ? row.n : 1079) + 1;
  }

  /** Allocate an id, skipping any that are already taken (defensive). */
  allocateId() {
    let candidate = `REQ-${this.nextNumber()}`;
    while (this.get('SELECT 1 AS x FROM requests WHERE id = ?', candidate)) {
      const n = Number.parseInt(candidate.replace('REQ-', ''), 10);
      candidate = `REQ-${n + 1}`;
    }
    return candidate;
  }

  insert({ id, propertyId, unit, tenantId, category, title, detail, urgency, status = 'submitted', created, updated }) {
    this.run(
      `INSERT INTO requests
         (id, property_id, unit, tenant_id, category, title, detail, urgency, status, tech_id, created, updated, photos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0)`,
      id, propertyId, unit, tenantId, category, title, detail, urgency, status, created, updated
    );
    return id;
  }

  updateStatus(id, status, updated) {
    this.run('UPDATE requests SET status = ?, updated = ? WHERE id = ?', status, updated, id);
  }

  assign(id, technicianId, urgency, updated) {
    this.run(
      'UPDATE requests SET tech_id = ?, urgency = ?, status = ?, updated = ? WHERE id = ?',
      technicianId, urgency, 'assigned', updated, id
    );
  }

  incrementPhotos(id, updated) {
    this.run('UPDATE requests SET photos = photos + 1, updated = ? WHERE id = ?', updated, id);
  }

  /* ---------------- comments / history / ratings ---------------- */

  commentsFor(requestId) {
    return this.all(
      'SELECT id, user_id, name, role_label, text, created_at FROM comments WHERE request_id = ? ORDER BY created_at ASC',
      requestId
    );
  }

  addComment({ requestId, userId, name, roleLabel, text, createdAt }) {
    this.run(
      'INSERT INTO comments (request_id, user_id, name, role_label, text, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      requestId, userId, name, roleLabel, text, createdAt
    );
  }

  historyFor(requestId) {
    return this.all(
      'SELECT status, created_at FROM history WHERE request_id = ? ORDER BY created_at ASC',
      requestId
    );
  }

  addHistory({ requestId, status, createdAt }) {
    this.run(
      'INSERT INTO history (request_id, status, created_at) VALUES (?, ?, ?)',
      requestId, status, createdAt
    );
  }

  ratingFor(requestId) {
    return this.get('SELECT stars FROM ratings WHERE request_id = ?', requestId);
  }

  addRating({ requestId, userId, stars, createdAt }) {
    this.run(
      'INSERT INTO ratings (request_id, user_id, stars, created_at) VALUES (?, ?, ?, ?)',
      requestId, userId, stars, createdAt
    );
  }

  /* ---------------- aggregates ---------------- */

  /**
   * Build the WHERE fragment that scopes requests to what `user` may see.
   * Keeps authorisation rules in one place instead of repeating them per query.
   *
   * @param {{role:string, id:string, technicianId?:string|null}} user
   * @returns {{where: string, params: string[], join: string}}
   */
  scopeFor(user) {
    if (user.role === 'admin') return { where: '1 = 1', params: [], join: '' };
    if (user.role === 'tenant') return { where: 'r.tenant_id = ?', params: [user.id], join: '' };
    if (user.role === 'technician') {
      // A technician without a technician record sees nothing.
      return {
        where: 'r.tech_id = ?',
        params: [user.technicianId || '__none__'],
        join: '',
      };
    }
    return {
      where: 'p.manager_id = ?',
      params: [user.id],
      join: 'LEFT JOIN properties p ON p.id = r.property_id',
    };
  }

  /**
   * Requests-per-category, scoped to the caller.
   * Categories with no requests are returned with a count of 0.
   */
  countByCategory(user) {
    const { where, params, join } = this.scopeFor(user);
    if (user.role === 'manager') {
      // The manager filter has to be applied to the *requests* rows, not to the
      // properties join, otherwise non-matching requests still get counted.
      return this.all(
        `SELECT c.id, c.name,
                COUNT(CASE WHEN p.manager_id = ? THEN r.id END) AS n
         FROM categories c
         LEFT JOIN requests r ON r.category = c.id
         LEFT JOIN properties p ON p.id = r.property_id
         GROUP BY c.id ORDER BY n DESC, c.name`,
        ...params
      );
    }
    return this.all(
      `SELECT c.id, c.name, COUNT(r.id) AS n FROM categories c
       LEFT JOIN requests r ON r.category = c.id AND ${where}
       GROUP BY c.id ORDER BY n DESC, c.name`,
      ...params
    );
  }

  countByStatus(user) {
    const { where, params, join } = this.scopeFor(user);
    return this.all(
      `SELECT r.status AS status, COUNT(*) AS n FROM requests r ${join}
       WHERE ${where} GROUP BY r.status ORDER BY n DESC`,
      ...params
    );
  }

  /** Total / open / resolved tally for the caller's scope. */
  totals(user) {
    const { where, params, join } = this.scopeFor(user);
    return this.get(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN r.status IN (${inList(OPEN_STATUSES)}) THEN 1 ELSE 0 END), 0) AS open,
         COALESCE(SUM(CASE WHEN r.status IN (${inList(RESOLVED_STATUSES)}) THEN 1 ELSE 0 END), 0) AS resolved
       FROM requests r ${join} WHERE ${where}`,
      ...params
    );
  }
}

module.exports = { RequestRepository, LIST_COLUMNS };
