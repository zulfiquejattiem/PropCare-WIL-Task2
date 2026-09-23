/**
 * UserRepository - everything that reads or writes the `users` (and `units`
 * and `technicians`) tables.
 */
const { BaseRepository } = require('./base.repository');

/** Columns safe to return to a client - never includes `password_hash`. */
const PUBLIC_COLUMNS = 'id, name, email, role, active, created_at';

class UserRepository extends BaseRepository {
  findById(id) {
    return this.get(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, id);
  }

  /** Full row including the password hash - used only by the auth layer. */
  findByIdFull(id) {
    return this.get('SELECT * FROM users WHERE id = ?', id);
  }

  findByEmail(email) {
    return this.get('SELECT * FROM users WHERE email = ?', String(email || '').toLowerCase());
  }

  list() {
    return this.all(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY name`);
  }

  listByRole(role) {
    return this.all(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE role = ? ORDER BY name`, role);
  }

  countByRole(role) {
    return this.count('SELECT COUNT(*) AS n FROM users WHERE role = ?', role);
  }

  countAll() {
    return this.count('SELECT COUNT(*) AS n FROM users');
  }

  unitsFor(userId) {
    return this.all(
      `SELECT u.name, p.id AS property_id, p.name AS property_name
       FROM units u JOIN properties p ON p.id = u.property_id
       WHERE u.user_id = ?`,
      userId
    );
  }

  /**
   * Next free `U<number>` id.
   *
   * Derived from the highest numeric suffix actually in use rather than from
   * the row count, so ids stay unique no matter how many rows exist.
   */
  nextId() {
    const rows = this.all("SELECT id FROM users WHERE id LIKE 'U%'");
    let max = 0;
    for (const row of rows) {
      const n = Number.parseInt(String(row.id).slice(1), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `U${max + 1}`;
  }

  insert({ id, name, email, passwordHash, role }) {
    this.run(
      `INSERT INTO users (id, name, email, password_hash, role, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      id,
      name,
      String(email).toLowerCase(),
      passwordHash,
      role,
      new Date().toISOString()
    );
    return id;
  }

  updateProfile(id, { name, email, passwordHash }) {
    this.run(
      'UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?',
      name,
      String(email).toLowerCase(),
      passwordHash,
      id
    );
  }

  setActive(id, active) {
    this.run('UPDATE users SET active = ? WHERE id = ?', active ? 1 : 0, id);
  }

  /* ---------------- tenant <-> unit assignment ---------------- */

  assignUnit(userId, propertyId, unitName) {
    return this.run(
      'INSERT INTO units (user_id, property_id, name) VALUES (?, ?, ?)',
      userId,
      propertyId,
      unitName
    );
  }

  /* ---------------- technician records ---------------- */

  createTechnician({ id, userId, skill }) {
    this.run('INSERT INTO technicians (id, user_id, skill) VALUES (?, ?, ?)', id, userId, skill);
    return id;
  }

  /** Next free `T<number>` technician id. */
  nextTechnicianId() {
    const rows = this.all("SELECT id FROM technicians WHERE id LIKE 'T%'");
    let max = 0;
    for (const row of rows) {
      const n = Number.parseInt(String(row.id).slice(1), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `T${max + 1}`;
  }

  /* ---------------- login throttling ---------------- */

  recordFailedLogin(id, attempts) {
    this.run('UPDATE users SET failed_logins = ? WHERE id = ?', attempts, id);
  }

  lockAccount(id, untilIso) {
    this.run('UPDATE users SET locked_until = ? WHERE id = ?', untilIso, id);
  }

  clearLoginFailures(id) {
    this.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', id);
  }
}

module.exports = { UserRepository, PUBLIC_COLUMNS };
