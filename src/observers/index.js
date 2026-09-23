/**
 * Observer registration - the single place where the bus is wired up.
 *
 * Called once from `src/app.js` at boot. To add a new reaction to a domain
 * event, write an observer class with a `handle(payload)` method and register
 * it here; no service or route code changes.
 */
const { eventBus } = require('./event-bus');
const { NotificationObserver } = require('./notification.observer');
const { AuditLogObserver } = require('./audit.observer');
const { repositories } = require('../repositories');

function registerObservers(bus = eventBus, repos = repositories) {
  bus.subscribe('*', new NotificationObserver(repos.notifications));
  bus.subscribe('*', new AuditLogObserver(repos.audit));
  return bus;
}

module.exports = { registerObservers, eventBus };
