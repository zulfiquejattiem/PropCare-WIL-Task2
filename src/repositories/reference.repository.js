/**
 * ReferenceRepository - the lookup data that drives the report-an-issue wizard
 * and the filter chips (categories, statuses, urgencies).
 */
const { BaseRepository } = require('./base.repository');
const { URGENCIES, STATUSES, OPEN_STATUSES } = require('../db');

class ReferenceRepository extends BaseRepository {
  categories() {
    return this.all('SELECT id, name FROM categories ORDER BY name');
  }

  findCategory(id) {
    return this.get('SELECT id, name FROM categories WHERE id = ?', id);
  }

  statuses() {
    return STATUSES;
  }

  urgencies() {
    return URGENCIES;
  }

  openStatuses() {
    return OPEN_STATUSES;
  }
}

module.exports = { ReferenceRepository };
