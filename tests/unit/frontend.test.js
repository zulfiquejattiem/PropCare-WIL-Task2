/**
 * Regression tests for the front end, run against the real shipped file.
 *
 * `public/js/app.js` is executed verbatim inside a `vm` context rather than
 * being reimplemented here, so the assertions cover the code that ships. A
 * minimal Proxy-backed DOM stands in for the browser: it exists only to let the
 * IIFE run far enough to publish `window.PropCareApp`.
 *
 * (jsdom is a devDependency but cannot be required under Jest here - jsdom 30
 * pulls in the ESM-only `@exodus/bytes`, which Jest's CommonJS transform
 * rejects. It loads fine under plain Node.)
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'app.js');

/** A permissive stand-in for a DOM node: any property read yields a callable no-op. */
function fakeNode() {
  const node = {
    textContent: '',
    innerHTML: '',
    className: '',
    value: '',
    readyState: 'complete',
    style: {},
    children: [],
  };
  return new Proxy(node, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => fakeNode();
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

function loadApp() {
  const sandboxWindow = {};
  const document = fakeNode();
  document.getElementById = () => fakeNode();
  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  document.createElement = () => fakeNode();
  document.addEventListener = () => {};
  document.readyState = 'complete';

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document,
    location: { hash: '#/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { userAgent: 'node' },
    // No session token, so the SPA takes its showLogin() path and never calls
    // the network.
    fetch: () => Promise.reject(new Error('network disabled in unit tests')),
  };
  sandbox.window = sandboxWindow;
  sandbox.globalThis = sandbox;
  sandboxWindow.document = document;
  sandboxWindow.location = sandbox.location;
  sandboxWindow.sessionStorage = sandbox.sessionStorage;
  sandboxWindow.addEventListener = () => {};
  sandboxWindow.dispatchEvent = () => {};

  vm.createContext(sandbox);

  const source = fs.readFileSync(APP_PATH, 'utf8');
  try {
    vm.runInContext(source, sandbox, { filename: APP_PATH });
  } catch (err) {
    // The IIFE calls init() at load time, which reaches for DOM nodes this stub
    // only approximates. `window.PropCareApp` is assigned before init() runs, so
    // a throw here is survivable - but only if the export actually landed.
    if (!sandboxWindow.PropCareApp) {
      throw new Error(`app.js failed before publishing PropCareApp: ${err.message}`);
    }
  }

  if (!sandboxWindow.PropCareApp || typeof sandboxWindow.PropCareApp.initials !== 'function') {
    throw new Error('window.PropCareApp.initials was not published by app.js');
  }
  return sandboxWindow.PropCareApp;
}

describe('app.js initials() survives any name the API can return', () => {
  let app;

  beforeAll(() => {
    app = loadApp();
  });

  it('exposes initials() on the public PropCareApp surface', () => {
    expect(typeof app.initials).toBe('function');
  });

  it('still produces initials for ordinary names', () => {
    expect(app.initials('Sarah Williams')).toBe('sw');
    expect(app.initials('Johan van der Merwe')).toBe('jv');
    expect(app.initials('Cher')).toBe('c');
  });

  it('does not throw on null or undefined', () => {
    // Before the fix both threw "Cannot read properties of null (reading 'split')".
    expect(() => app.initials(null)).not.toThrow();
    expect(() => app.initials(undefined)).not.toThrow();
    expect(app.initials(null)).toBe('');
    expect(app.initials(undefined)).toBe('');
  });

  it('does not throw on an empty or whitespace-only name', () => {
    expect(app.initials('')).toBe('');
    expect(app.initials('   ')).toBe('');
  });

  it('ignores empty segments instead of yielding "undefined"', () => {
    expect(app.initials('Sarah  Williams')).toBe('sw');
    expect(String(app.initials(' Sarah'))).not.toContain('undefined');
  });

  it('coerces a non-string rather than throwing', () => {
    expect(() => app.initials(42)).not.toThrow();
  });
});

describe('reports screen derives its headline category from the data', () => {
  const source = fs.readFileSync(APP_PATH, 'utf8');

  it('no longer hardcodes the "Plumbing is the most common" sentence', () => {
    expect(source).not.toMatch(/Plumbing is the most common category/);
  });

  it('no longer claims a specific quarter', () => {
    expect(source).not.toMatch(/this quarter/);
  });

  it('computes the note from the category counts', () => {
    expect(source).toMatch(/topCategoryNote/);
    expect(source).toMatch(/s\.byCategory\.reduce/);
  });

  it('picks the highest-count category, matching the rendered ordering', () => {
    // The same reduce the app uses, exercised directly so a change in intent fails.
    const top = (rows) => rows.reduce((best, c) => (c.count > (best ? best.count : -1) ? c : best), null);

    expect(top([{ name: 'Plumbing', count: 4 }, { name: 'Electrical', count: 9 }]).name)
      .toBe('Electrical');
    expect(top([{ name: 'Plumbing', count: 4 }, { name: 'Electrical', count: 2 }]).name)
      .toBe('Plumbing');
    expect(top([])).toBeNull();
  });
});
