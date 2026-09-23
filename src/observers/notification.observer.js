/**
 * NotificationObserver - turns domain events into in-app notifications.
 *
 * Concrete observer: it knows *who* should be told about *what*, and it is the
 * only place that decides notification wording.
 */
const ICONS = {
  info: '🔧',
  done: '✅',
  star: '⭐',
  bell: '🔔',
  warn: '⚠️',
};

/** Human phrasing for each action, so the UI never has to build sentences. */
const PAST_TENSE = {
  cancel: 'cancelled',
  confirm: 'confirmed and closed',
  approve: 'approved and closed',
  reject: 'rejected',
  accept: 'accepted',
  hold: 'placed on hold',
  resume: 'resumed',
  complete: 'completed',
  reopen: 'reopened',
  assign: 'assigned to a technician',
  rate: 'rated',
};

class NotificationObserver {
  constructor(notifications) {
    this.name = 'NotificationObserver';
    this.notifications = notifications;
  }

  handle(event) {
    const { type, at, request, actor, action, technicianName, stars, technicianId } = event;

    if (type === 'request.created') {
      if (event.managerId) {
        this.push(event.managerId, ICONS.info,
          `New request ${request.id} submitted by ${actor.name}.`, at);
      }
      return;
    }

    if (type === 'request.assigned') {
      this.pushByUserId(event.technicianUserId, ICONS.info,
        `You have been assigned ${request.id} - ${request.title}.`, at);
      this.push(request.tenantId, ICONS.info,
        `${actor.name} assigned a technician to ${request.id}.`, at);
      return;
    }

    if (type === 'request.status_changed') {
      const verb = PAST_TENSE[action] || 'updated';

      // The tenant owns the request: keep them informed on every transition.
      if (request.tenantId) {
        const icon = action === 'complete' || action === 'accept' ? ICONS.info : ICONS.done;
        this.push(request.tenantId, icon,
          `Request ${request.id} was ${verb} by ${actor.name}.`, at);
      }

      // The property manager follows technician-driven progress.
      if (event.managerId && event.managerId !== actor.id) {
        this.push(event.managerId, ICONS.info,
          `${actor.name} ${verb} ${request.id}.`, at);
      }

      // The assigned technician hears about tenant-side decisions.
      if (event.technicianUserId && event.technicianUserId !== actor.id &&
          (action === 'reopen' || action === 'cancel' || action === 'confirm')) {
        this.pushByUserId(event.technicianUserId, ICONS.warn,
          `${actor.name} ${verb} ${request.id}.`, at);
      }
      return;
    }

    if (type === 'request.rated') {
      if (event.managerId) {
        this.push(event.managerId, ICONS.star,
          `${actor.name} rated ${request.id} ${stars}/5.`, at);
      }
      return;
    }

    if (type === 'request.commented') {
      if (request.tenantId && request.tenantId !== actor.id) {
        this.push(request.tenantId, ICONS.bell,
          `${actor.name} commented on ${request.id}.`, at);
      }
      if (event.managerId && event.managerId !== actor.id) {
        this.push(event.managerId, ICONS.bell,
          `${actor.name} commented on ${request.id}.`, at);
      }
      return;
    }

    if (type === 'user.created') {
      this.push(event.userId, ICONS.bell,
        'Welcome to PropCare. Your account is ready to use.', at);
      return;
    }

    if (type === 'user.status_changed') {
      this.push(event.userId, event.active ? ICONS.done : ICONS.warn,
        event.active
          ? 'Your PropCare account has been reactivated.'
          : 'Your PropCare account has been deactivated. Contact an administrator.',
        at);
    }
  }

  push(userId, icon, title, at) {
    if (!userId) return;
    this.notifications.insert({ userId, icon, title, createdAt: at });
  }

  /** Technician events arrive as a user id; request events carry the tech id. */
  pushByUserId(userId, icon, title, at) {
    this.push(userId, icon, title, at);
  }
}

module.exports = { NotificationObserver, PAST_TENSE, ICONS };
