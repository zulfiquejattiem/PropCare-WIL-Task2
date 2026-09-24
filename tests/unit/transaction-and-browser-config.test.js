/**
 * Regression tests for two defects that could not be caught by a syntax check.
 *
 *   1. `transaction()` ran `BEGIN; fn(); COMMIT` without awaiting `fn()`. An
 *      async callback therefore committed before its writes happened, and a
 *      later failure could not be rolled back - silent data corruption. It now
 *      rejects async callbacks loudly instead.
 *   2. `scripts/browser-test.js` referenced an undeclared `CHROME` constant, so
 *      `npm run test:browser` threw `ReferenceError: CHROME is not defined`
 *      the moment it reached `puppeteer.launch`.
 */
const fs = require('node:fs');
const path = require('node:path');
const { db, transaction } = require('../../src/db');

describe('transaction() guards against async callbacks', () => {
  it('rejects an async callback instead of silently committing', () => {
    let rejection = null;
    try {
      transaction(async () => {
        db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').run('zz-async', 'should not persist');
      });
    } catch (err) {
      rejection = err;
    }

    expect(rejection).toBeInstanceOf(TypeError);
    expect(rejection.message).toMatch(/async callbacks/);

    // The write made inside the rejected transaction must not have survived.
    const leaked = db.prepare("SELECT id FROM categories WHERE id = 'zz-async'").get();
    expect(leaked).toBeUndefined();
  });

  it('leaves the connection usable after rejecting an async callback', () => {
    // If the guard left a transaction open, this next BEGIN would fail.
    expect(() => {
      transaction(() => {
        db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').run('zz-after', 'recovered');
      });
    }).not.toThrow();

    const row = db.prepare("SELECT name FROM categories WHERE id = 'zz-after'").get();
    expect(row).toBeDefined();
    expect(row.name).toBe('recovered');
  });

  it('still commits a synchronous callback', () => {
    const result = transaction(() => {
      db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').run('zz-sync', 'committed');
      return 'return-value';
    });

    expect(result).toBe('return-value');
    expect(db.prepare("SELECT id FROM categories WHERE id = 'zz-sync'").get()).toBeDefined();
  });

  it('still rolls back when a synchronous callback throws', () => {
    expect(() => {
      transaction(() => {
        db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').run('zz-rollback', 'should not persist');
        throw new Error('boom');
      });
    }).toThrow('boom');

    expect(db.prepare("SELECT id FROM categories WHERE id = 'zz-rollback'").get()).toBeUndefined();
  });

  it('rejects a non-function argument', () => {
    expect(() => transaction(null)).toThrow(TypeError);
    expect(() => transaction('nope')).toThrow(TypeError);
  });
});

describe('scripts/browser-test.js declares its CHROME constant', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'browser-test.js'),
    'utf8'
  );

  it('declares CHROME before puppeteer.launch uses it', () => {
    // The bug: CHROME was *used* but never declared, so launching the browser
    // threw a ReferenceError at runtime.
    expect(source).toMatch(/\b(?:const|let|var)\s+CHROME\s*=/);

    const declaration = source.search(/\b(?:const|let|var)\s+CHROME\s*=/);
    const usage = source.indexOf('executablePath: CHROME');
    expect(usage).toBeGreaterThan(-1);
    expect(declaration).toBeLessThan(usage);
  });

  it('reads CHROME from an environment variable so it can be left unset', () => {
    const line = source.split('\n').find((l) => /\b(?:const|let|var)\s+CHROME\s*=/.test(l));
    expect(line).toMatch(/process\.env\./);
  });
});

describe('the seed routine never logs the demo password', () => {
  const dbSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'db.js'),
    'utf8'
  );

  it('has no console.log that interpolates DEMO_PASSWORD', () => {
    // The bug: every boot printed `[propcare] demo password for all accounts:
    // <the password>`. render.yaml takes DEMO_PASSWORD from the dashboard with
    // no hint it must be throwaway, so a real password would land in the log
    // stream. `seedDatabase` is a no-op once the database is populated, so this
    // is asserted against the source rather than by capturing a live call.
    const offenders = dbSource
      .split('\n')
      .filter((line) => /console\.(log|info|warn|error)/.test(line) && /\$\{process\.env\.DEMO_PASSWORD\}/.test(line));

    expect(offenders).toEqual([]);
  });

  it('still reports that the demo accounts are ready', () => {
    expect(dbSource).toMatch(/demo accounts ready/);
  });
});
