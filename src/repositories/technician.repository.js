/**
 * TechnicianRepository - the `technicians` trade records that sit behind a
 * technician user account.
 */
const { BaseRepository } = require('./base.repository');

class TechnicianRepository extends BaseRepository {
  listAll() {
    return this.all(
      `SELECT t.id, u.id AS user_id, u.name, u.email, t.skill
       FROM technicians t JOIN users u ON u.id = t.user_id ORDER BY u.name`
    );
  }

  findById(id) {
    return this.get(
      `SELECT t.id, u.id AS user_id, u.name, u.email, t.skill
       FROM technicians t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
      id
    );
  }

  findByUserId(userId) {
    return this.get(
      `SELECT t.id, u.id AS user_id, u.name, u.email, t.skill
       FROM technicians t JOIN users u ON u.id = t.user_id WHERE u.id = ?`,
      userId
    );
  }

  countAll() {
    return this.count('SELECT COUNT(*) AS n FROM technicians');
  }
}

module.exports = { TechnicianRepository };
