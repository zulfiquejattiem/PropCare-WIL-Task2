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

/**
 * Buses that have already been wired up.
 *
 * `registerObservers()` runs at module scope in `src/app.js` and registers onto
 * the shared singleton bus. If that module is ever evaluated twice while the
 * bus survives (test isolation via `jest.resetModules()`, a hot reload), the
 * observers would stack up and every event would be handled twice - duplicate
 * notifications and duplicate audit rows. Tracking registration keeps the call
 * idempotent.
 */
const registeredBuses = new WeakSet();

function registerObservers(bus = eventBus, repos = repositories) {
  if (registeredBuses.has(bus)) return bus;
  registeredBuses.add(bus);

  bus.subscribe('*', new NotificationObserver(repos.notifications));
  bus.subscribe('*', new AuditLogObserver(repos.audit));
  return bus;
}

module.exports = { registerObservers, eventBus };
