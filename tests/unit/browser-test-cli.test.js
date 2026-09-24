/**
 * Regression tests for the headless browser runner's CLI surface.
 *
 * The script cannot be executed here - it needs a live server and a browser -
 * so these assert on the source. Both defects were "declared but never used"
 * features: a documented flag that did nothing, and a helper written for
 * failure diagnostics that was never called.
 */
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'scripts', 'browser-test.js'),
  'utf8'
);

const lines = source.split('\n');
const findLine = (re) => lines.findIndex((l) => re.test(l));

describe('--shots-only actually changes behaviour', () => {
  it('declares SHOTS_ONLY from the command line', () => {
    expect(source).toMatch(/const SHOTS_ONLY = process\.argv\.indexOf\('--shots-only'\) !== -1;/);
  });

  it('reads SHOTS_ONLY somewhere other than its own declaration', () => {
    // The bug: SHOTS_ONLY appeared exactly once in the file - its declaration -
    // so `npm run test:browser:shots` ran the full asserting suite.
    const uses = lines.filter((l) => /SHOTS_ONLY/.test(l));
    expect(uses.length).toBeGreaterThan(1);

    const declaration = findLine(/const SHOTS_ONLY =/);
    const someUseAfterDeclaration = lines.some((l, i) => i > declaration && /SHOTS_ONLY/.test(l));
    expect(someUseAfterDeclaration).toBe(true);
  });

  it('stops a failed check from being recorded as a failure in shots-only mode', () => {
    // `record()` is the single funnel every assertion reports through, so
    // downgrading FAIL there is what makes the flag mean "no asserts".
    const recordStart = findLine(/^function record\(/);
    expect(recordStart).toBeGreaterThan(-1);

    const recordBody = lines.slice(recordStart, recordStart + 16).join('\n');
    expect(recordBody).toMatch(/SHOTS_ONLY && status === FAIL/);
    expect(recordBody).toMatch(/status: INFO/);
  });

  it('keeps PASS results intact in shots-only mode', () => {
    const recordStart = findLine(/^function record\(/);
    const recordBody = lines.slice(recordStart, recordStart + 16).join('\n');
    // Only FAIL is downgraded; PASS must still be recorded as PASS.
    expect(recordBody).toMatch(/results\.push\(\{ step, status, note \}\)/);
  });
});

describe('failures capture a diagnostic screenshot', () => {
  it('errFile() is actually used', () => {
    // The bug: errFile() was defined but never called, so the error-screenshot
    // feature it existed for was never wired up.
    const uses = lines.filter((l) => /errFile\(/.test(l));
    expect(uses.length).toBeGreaterThan(1);
  });

  it('defines a captureError helper that writes to errFile()', () => {
    expect(source).toMatch(/async function captureError\(/);
    const start = findLine(/async function captureError\(/);
    const body = lines.slice(start, start + 16).join('\n');
    expect(body).toMatch(/errFile\(kind, roleOrName\)/);
    expect(body).toMatch(/page\.screenshot/);
    expect(body).toMatch(/mkdirSync/);
  });

  it('captureError never lets a screenshot failure mask the real error', () => {
    const start = findLine(/async function captureError\(/);
    const body = lines.slice(start, start + 16).join('\n');
    expect(body).toMatch(/try \{/);
    expect(body).toMatch(/catch \(e\) \{/);
    expect(body).toMatch(/return null/);
  });

  it('is called from the login failure path', () => {
    const start = findLine(/async function login\(/);
    const body = lines.slice(start, start + 26).join('\n');
    expect(body).toMatch(/captureError\(page, 'login', role\)/);
  });

  it('is called from the manager-assign failure path', () => {
    expect(source).toMatch(/captureError\(page, 'manager-assign', id\)/);
  });
});
