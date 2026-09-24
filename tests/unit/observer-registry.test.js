/**
 * Regression tests for the observer wiring.
 *
 * Two distinct defects are locked down here:
 *
 *   1. `EventBus.unsubscribe` used to match observers by their `name` string, so
 *      unsubscribing one observer silently removed every other observer that
 *      happened to share that display name.
 *   2. `registerObservers()` was not idempotent. It registers onto the shared
 *      singleton bus, so a second evaluation of `src/app.js` (test isolation,
 *      hot reload) doubled every observer - meaning duplicate notifications and
 *      duplicate audit rows for a single domain event.
 */
const { EventBus } = require('../../src/observers/event-bus');

class Recorder {
  constructor(name) {
    this.name = name;
    this.seen = [];
  }
  handle(payload) {
    this.seen.push(payload);
  }
}

describe('EventBus.unsubscribe matches by identity, not by name', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('removes only the targeted observer when two observers share a name', () => {
    const first = new Recorder('Reporter');
    const second = new Recorder('Reporter');

    const off = bus.subscribe('request.created', first);
    bus.subscribe('request.created', second);
    expect(bus.listenerCount('request.created')).toBe(2);

    off();

    // Before the fix this dropped to 0: both observers were removed because
    // they were indistinguishable by name.
    expect(bus.listenerCount('request.created')).toBe(1);

    bus.emit('request.created', { id: 'REQ-1' });
    expect(first.seen).toHaveLength(0);
    expect(second.seen).toHaveLength(1);
  });

  it('still removes an observer when it is the only subscriber', () => {
    const observer = new Recorder('solo');
    const off = bus.subscribe('request.created', observer);

    off();

    expect(bus.listenerCount('request.created')).toBe(0);
    bus.emit('request.created', { id: 'REQ-2' });
    expect(observer.seen).toHaveLength(0);
  });

  it('removes every subscription belonging to the SAME observer instance', () => {
    // Unsubscribing is by instance, so an observer registered twice is fully
    // withdrawn - it should not keep receiving the event through the entry that
    // the caller did not name.
    const observer = new Recorder('twice');
    const other = new Recorder('stays');
    const offFirst = bus.subscribe('request.created', observer);
    bus.subscribe('request.created', observer);
    bus.subscribe('request.created', other);
    expect(bus.listenerCount('request.created')).toBe(3);

    offFirst();

    expect(bus.listenerCount('request.created')).toBe(1);
    bus.emit('request.created', { id: 'REQ-3' });
    expect(observer.seen).toHaveLength(0);
    expect(other.seen).toHaveLength(1);
  });

  it('leaves a different event untouched when unsubscribing', () => {
    const observer = new Recorder('multi');
    const off = bus.subscribe('request.created', observer);
    bus.subscribe('request.rated', observer);

    off();

    expect(bus.listenerCount('request.created')).toBe(0);
    expect(bus.listenerCount('request.rated')).toBe(1);
  });

  it('tolerates unsubscribing from an event that was never used', () => {
    expect(() => bus.unsubscribe('nope', new Recorder('ghost'))).not.toThrow();
  });
});

describe('registerObservers is idempotent', () => {
  const { registerObservers, eventBus } = require('../../src/observers');

  it('registers exactly two observers on a fresh bus, however often it is called', () => {
    const bus = new EventBus();

    registerObservers(bus);
    expect(bus.listenerCount('*')).toBe(2);

    registerObservers(bus);
    registerObservers(bus);

    // Before the fix each call appended two more observers.
    expect(bus.listenerCount('*')).toBe(2);
  });

  it('returns the bus it was given', () => {
    const bus = new EventBus();
    expect(registerObservers(bus)).toBe(bus);
  });

  it('does not add observers to the singleton bus on a repeat call', () => {
    // This unit file never requires `src/app.js`, so the shared singleton starts
    // empty here. The point under test is that repeat calls are a no-op, not
    // what the absolute count is - so capture the baseline after the first call.
    registerObservers();
    const baseline = eventBus.listenerCount('*');
    expect(baseline).toBe(2);

    registerObservers();
    registerObservers();

    // Before the fix each extra call appended two more observers.
    expect(eventBus.listenerCount('*')).toBe(baseline);
  });

  it('still wires a brand-new bus that was never registered before', () => {
    const bus = new EventBus();
    expect(bus.listenerCount('*')).toBe(0);

    registerObservers(bus);

    expect(bus.listenerCount('*')).toBe(2);
  });
});
