/**
 * BaseRepository - the shared plumbing for every repository.
 *
 * Repository pattern: each repository hides the persistence mechanism behind a
 * domain-flavoured API ("findRequestsForTenant", not "SELECT ..."). Callers
 * never see SQL, the driver, or the table layout, which is what lets the data
 * layer be swapped or optimised without touching a route or a service.
 *
 * Statements are prepared once and cached per repository instance, so a hot
 * endpoint re-uses the compiled statement instead of re-preparing on each call.
 */
const { db, transaction } = require('../db');

class BaseRepository {
  constructor() {
    /** @type {Map<string, object>} compiled statement cache, keyed by SQL text */
    this._statements = new Map();
  }

  /** Return a cached prepared statement for `text`, compiling it on first use. */
  prepare(text) {
    let statement = this._statements.get(text);
    if (!statement) {
      statement = db.prepare(text);
      this._statements.set(text, statement);
    }
    return statement;
  }

  /** Single row or undefined. */
  get(text, ...params) {
    return this.prepare(text).get(...params);
  }

  /** All matching rows. */
  all(text, ...params) {
    return this.prepare(text).all(...params);
  }

  /** Write; returns the driver result (lastInsertRowid / changes). */
  run(text, ...params) {
    return this.prepare(text).run(...params);
  }

  /** Scalar helper: `SELECT COUNT(*) AS n` -> number. */
  count(text, ...params) {
    const row = this.get(text, ...params);
    return row ? row.n : 0;
  }

  /** Group several writes into one atomic unit. */
  transaction(fn) {
    return transaction(fn);
  }
}

module.exports = { BaseRepository };
