/**
 * AuditLogObserver - writes an append-only record of every state-changing
 * action, giving administrators a forensic trail.
 *
 * Concrete observer on the same bus as NotificationObserver: the two concerns
 * stay independent, and either can be disabled without touching the services.
 */
const { PAST_TENSE } = require('./notification.observer');

class AuditLogObserver {
  constructor(audit) {
    this.name = 'AuditLogObserver';
    this.audit = audit;
  }

  handle(event) {
    const { type, at, actor, request, action, stars, technicianId } = event;
    const base = {
      actorId: actor ? actor.id : null,
      actorName: actor ? actor.name : 'system',
      createdAt: at,
    };

    switch (type) {
      case 'request.created':
        this.audit.record({
          ...base,
          action: 'request.create',
          entityType: 'request',
          entityId: request.id,
          detail: `${request.category} · ${request.urgency} · ${request.unit}`,
        });
        break;

      case 'request.assigned':
        this.audit.record({
          ...base,
          action: 'request.assign',
          entityType: 'request',
          entityId: request.id,
          detail: `technician ${technicianId} · urgency ${request.urgency}`,
        });
        break;

      case 'request.status_changed':
        this.audit.record({
          ...base,
          action: `request.${action}`,
          entityType: 'request',
          entityId: request.id,
          detail: `${request.status} -> ${event.nextStatus}`,
        });
        break;

      case 'request.rated':
        this.audit.record({
          ...base,
          action: 'request.rate',
          entityType: 'request',
          entityId: request.id,
          detail: `${stars}/5`,
        });
        break;

      case 'request.commented':
        this.audit.record({
          ...base,
          action: 'request.comment',
          entityType: 'request',
          entityId: request.id,
        });
        break;

      case 'request.photo_added':
        this.audit.record({
          ...base,
          action: 'request.photo',
          entityType: 'request',
          entityId: request.id,
        });
        break;

      case 'user.created':
        this.audit.record({
          ...base,
          action: 'user.create',
          entityType: 'user',
          entityId: event.userId,
          detail: `role ${event.role}`,
        });
        break;

      case 'user.status_changed':
        this.audit.record({
          ...base,
          action: event.active ? 'user.activate' : 'user.deactivate',
          entityType: 'user',
          entityId: event.userId,
        });
        break;

      case 'user.updated_profile':
        this.audit.record({
          ...base,
          action: 'user.update_profile',
          entityType: 'user',
          entityId: event.userId,
        });
        break;

      case 'auth.login':
        this.audit.record({
          ...base,
          action: event.success ? 'auth.login' : 'auth.login_failed',
          entityType: 'user',
          entityId: event.userId || null,
          detail: event.reason || null,
        });
        break;

      default:
        break;
    }
  }

  static describe(action) {
    return PAST_TENSE[action] || action;
  }
}

module.exports = { AuditLogObserver };
