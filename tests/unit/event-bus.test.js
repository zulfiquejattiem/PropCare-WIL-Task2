/**
 * Unit tests for the Observer pattern implementation.
 *
 * These exercise the EventBus in isolation - no HTTP, no Express - to prove the
 * publish/subscribe contract the services rely on.
 */
const { EventBus } = require('../../src/observers/event-bus');

class Recorder {
  constructor(name) {
    this.name = name;
    this.seen = [];
  }
  handle(payload) {
    this.seen.push(payload);
    if (this.boom) throw new Error('observer exploded');
  }
}

describe('EventBus (Observer pattern)', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('delivers a published event to a subscribed observer', () => {
    const observer = new Recorder('a');
    bus.subscribe('request.created', observer);

    bus.emit('request.created', { id: 'REQ-1' });

    expect(observer.seen).toEqual([{ id: 'REQ-1' }]);
  });

  it('does not deliver events the observer did not subscribe to', () => {
    const observer = new Recorder('a');
    bus.subscribe('request.created', observer);

    bus.emit('request.rated', { id: 'REQ-1' });

    expect(observer.seen).toHaveLength(0);
  });

  it('supports wildcard observers that see every event', () => {
    const observer = new Recorder('audit');
    bus.subscribe('*', observer);

    bus.emit('request.created', { id: 'REQ-1' });
    bus.emit('request.rated', { id: 'REQ-1', stars: 5 });

    expect(observer.seen).toHaveLength(2);
  });

  it('fans out to every observer of an event', () => {
    const a = new Recorder('a');
    const b = new Recorder('b');
    bus.subscribe('request.created', a);
    bus.subscribe('request.created', b);

    bus.emit('request.created', { id: 'REQ-2' });

    expect(a.seen).toHaveLength(1);
    expect(b.seen).toHaveLength(1);
    expect(bus.listenerCount('request.created')).toBe(2);
  });

  it('stops delivering after unsubscribe', () => {
    const observer = new Recorder('a');
    const off = bus.subscribe('request.created', observer);

    off();
    bus.emit('request.created', { id: 'REQ-3' });

    expect(observer.seen).toHaveLength(0);
    expect(bus.listenerCount('request.created')).toBe(0);
  });

  it('isolates a failing observer so one bad listener cannot break the others', () => {
    const broken = new Recorder('broken');
    broken.boom = true;
    const healthy = new Recorder('healthy');
    bus.subscribe('request.created', broken);
    bus.subscribe('request.created', healthy);

    // Must not throw.
    expect(() => bus.emit('request.created', { id: 'REQ-4' })).not.toThrow();

    expect(broken.seen).toHaveLength(1);
    expect(healthy.seen).toHaveLength(1);
  });

  it('rejects observers that do not implement handle()', () => {
    expect(() => bus.subscribe('x', { name: 'nope' })).toThrow(TypeError);
  });
});
