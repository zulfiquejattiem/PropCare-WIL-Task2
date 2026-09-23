/**
 * AuditRepository - append-only security/activity log.
 *
 * Every privileged or state-changing action is recorded here by the
 * AuditLogObserver, giving administrators a forensic trail (who did what, to
 * which entity, and when).
 */
const { BaseRepository } = require('./base.repository');

class AuditRepository extends BaseRepository {
  record({ actorId, actorName, action, entityType, entityId, detail, createdAt }) {
    this.run(
      `INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      actorId || null,
      actorName || 'system',
      action,
      entityType,
      entityId || null,
      detail || null,
      createdAt
    );
  }

  /** Most recent first; `limit` is clamped so a client cannot dump the table. */
  recent(limit = 100) {
    const safe = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 500);
    return this.all(
      `SELECT id, actor_id, actor_name, action, entity_type, entity_id, detail, created_at
       FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ?`,
      safe
    );
  }
}

module.exports = { AuditRepository };
