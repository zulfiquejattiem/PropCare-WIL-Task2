/**
 * PropertyRepository - properties, and the per-property request breakdown used
 * by the portfolio and reports screens.
 */
const { BaseRepository } = require('./base.repository');
const { OPEN_STATUSES } = require('../db');

/** Reusable "open requests per property" fragment, so the status list is defined once. */
function openStatusCase() {
  const list = OPEN_STATUSES.map((s) => `'${s}'`).join(', ');
  return `CASE WHEN r.status IN (${list}) THEN 1 ELSE 0 END`;
}

class PropertyRepository extends BaseRepository {
  listAll() {
    return this.all(
      `SELECT p.*, u.name AS manager_name FROM properties p
       JOIN users u ON u.id = p.manager_id ORDER BY p.name`
    );
  }

  forManager(managerId) {
    return this.all(
      `SELECT p.*, u.name AS manager_name FROM properties p
       JOIN users u ON u.id = p.manager_id WHERE p.manager_id = ? ORDER BY p.name`,
      managerId
    );
  }

  /** Properties a tenant has raised at least one request against. */
  forTenant(tenantId) {
    return this.all(
      `SELECT DISTINCT p.*, u.name AS manager_name FROM properties p
       JOIN users u ON u.id = p.manager_id
       JOIN requests r ON r.property_id = p.id
       WHERE r.tenant_id = ? ORDER BY p.name`,
      tenantId
    );
  }

  forTechnician(technicianId) {
    return this.all(
      `SELECT DISTINCT p.*, u.name AS manager_name
       FROM properties p
       JOIN users u ON u.id = p.manager_id
       JOIN requests r ON r.property_id = p.id
       WHERE r.tech_id = ? ORDER BY p.name`,
      technicianId
    );
  }

  findById(id) {
    return this.get(
      `SELECT p.*, u.name AS manager_name FROM properties p
       JOIN users u ON u.id = p.manager_id WHERE p.id = ?`,
      id
    );
  }

  insert({ id, name, address, area, managerId }) {
    this.run(
      'INSERT INTO properties (id, name, address, area, manager_id) VALUES (?, ?, ?, ?, ?)',
      id, name, address, area, managerId
    );
    return id;
  }

  countAll() {
    return this.count('SELECT COUNT(*) AS n FROM properties');
  }

  countUnits() {
    return this.count('SELECT COUNT(*) AS n FROM units');
  }

  /**
   * Request totals per property.
   *
   * @param {object}  [opts]
   * @param {string}  [opts.managerId] scope the breakdown to one manager's portfolio
   * @param {boolean} [opts.openOnly]  count open requests only (not total requests)
   */
  requestCounts({ managerId, openOnly = false } = {}) {
    const what = openOnly ? `SUM(${openStatusCase()})` : 'COUNT(r.id)';
    if (managerId) {
      return this.all(
        `SELECT p.id, p.name, ${what} AS n FROM properties p
         LEFT JOIN requests r ON r.property_id = p.id
         WHERE p.manager_id = ? GROUP BY p.id ORDER BY p.name`,
        managerId
      );
    }
    return this.all(
      `SELECT p.id, p.name, ${what} AS n FROM properties p
       LEFT JOIN requests r ON r.property_id = p.id GROUP BY p.id ORDER BY p.name`
    );
  }

  /** Open-request count for a single property (0 when it has none). */
  openCountFor(propertyId) {
    return this.count(
      `SELECT COALESCE(SUM(${openStatusCase()}), 0) AS n
       FROM properties p LEFT JOIN requests r ON r.property_id = p.id
       WHERE p.id = ?`,
      propertyId
    );
  }
}

module.exports = { PropertyRepository };
