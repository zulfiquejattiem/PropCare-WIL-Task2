/**
 * EventBus - the *Subject* in the Observer pattern.
 *
 * The domain services (see `src/services/requests.js`) publish what happened -
 * "request.created", "request.status_changed", ... - without caring who reacts.
 * Observers subscribe once at boot (see `src/observers/index.js`) and each one
 * handles its own concern:
 *
 *   NotificationObserver -> writes the in-app activity feed
 *   AuditLogObserver     -> writes the tamper-evident audit trail
 *
 * Adding a new reaction (email, SMS, webhook, SLA timer) means registering one
 * more observer; no service code changes. That is the decoupling Task 1's
 * Observer pattern is meant to demonstrate.
 *
 * Observer failures are isolated: a broken listener is logged and skipped so a
 * side effect can never fail the request that triggered it.
 */
const logger = require('../utils/logger');

class EventBus {
  constructor() {
    /** @type {Map<string, Array<{name:string, handler:Function}>>} */
    this.listeners = new Map();
  }

  /**
   * Register an observer for an event (or for `'*'` to see every event).
   * @param {string} event
   * @param {{name: string, handle: (payload: object) => void}} observer
   * @returns {() => void} unsubscribe function
   */
  subscribe(event, observer) {
    if (!observer || typeof observer.handle !== 'function') {
      throw new TypeError('Observer must expose a handle(payload) method');
    }
    const key = String(event);
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    // `observer` is kept on the entry so unsubscribe can match by *identity*.
    // Matching on `name` alone would remove every observer that happens to
    // share a display name.
    const entry = {
      name: observer.name || 'anonymous',
      observer,
      handler: observer.handle.bind(observer),
    };
    this.listeners.get(key).push(entry);
    return () => this.unsubscribe(event, observer);
  }

  unsubscribe(event, observer) {
    const key = String(event);
    const list = this.listeners.get(key);
    if (!list) return;
    // Remove only this exact observer instance.
    const next = list.filter((entry) => entry.observer !== observer);
    if (next.length) this.listeners.set(key, next);
    else this.listeners.delete(key);
  }

  /** Number of observers for an event - used by the unit tests. */
  listenerCount(event) {
    return (this.listeners.get(String(event)) || []).length;
  }

  /**
   * Publish an event. Synchronous so that observers write inside the caller's
   * transaction-like flow; errors never propagate back to the caller.
   */
  emit(event, payload = {}) {
    const key = String(event);
    const targets = (this.listeners.get(key) || []).concat(this.listeners.get('*') || []);
    for (const entry of targets) {
      try {
        entry.handler(payload);
      } catch (err) {
        logger.error('Observer failed', {
          observer: entry.name,
          event: key,
          message: err.message,
        });
      }
    }
  }
}

/** Application-wide bus. */
const eventBus = new EventBus();

module.exports = { EventBus, eventBus };
