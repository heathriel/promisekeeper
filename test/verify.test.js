const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Exercise the real CLI against throwaway local data, never the repository's
// promises.json. No escrow commands or external services are involved.
function check(t, spec, filename = 'report.txt') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promisekeeper-verify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(__dirname, '..', 'verify.js'), path.join(dir, 'verify.js'));
  fs.writeFileSync(path.join(dir, filename), 'local fixture\n');
  fs.writeFileSync(path.join(dir, 'promises.json'), JSON.stringify({
    promises: [{
      id: 'promise_test', promise: 'Verify local fixture', status: 'active',
      deadline: '2099-01-01T00:00:00Z',
      deadline_timestamp: Date.parse('2099-01-01T00:00:00Z'),
      verification_spec: spec
    }]
  }));
  const result = spawnSync(process.execPath, [path.join(dir, 'verify.js'), 'check', 'promise_test'], {
    cwd: dir, env: { ...process.env, WORKSPACE: dir }, encoding: 'utf8', timeout: 10000
  });
  assert.ifError(result.error);
  return result;
}

for (const field of ['created_after', 'modified_after']) {
  test(`${field}: rejects a future ISO timestamp`, t => {
    const result = check(t, `file:path=report.txt,${field}=2098-01-01T12:34:56Z`);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /must be after 2098-01-01T12:34:56Z/);
    assert.doesNotMatch(result.stdout, /PROMISEKEEPER_VERIFY_promise_test_SUCCESS/);
  });

  test(`${field}: accepts a past ISO timestamp with timezone offset`, t => {
    const value = '2000-01-01T12:34:56+01:00';
    const result = check(t, `file:path=report.txt,${field}=${value}`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes(`"${field}": "${value}"`));
  });

  for (const value of ['not-a-date', '']) {
    test(`${field}: fails closed for ${JSON.stringify(value)}`, t => {
      const result = check(t, `file:path=report.txt,${field}=${value}`);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, new RegExp(`Invalid ${field} timestamp`));
      assert.doesNotMatch(result.stdout, /PROMISEKEEPER_VERIFY_promise_test_SUCCESS/);
    });
  }
}

test('checks parameters following a timestamp containing colons', t => {
  const result = check(t, 'file:path=report.txt,created_after=2000-01-01T00:00:00Z,modified_after=2098-01-01T00:00:00Z');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /must be after 2098-01-01T00:00:00Z/);
});

test('preserves equals signs in parameter values', t => {
  const result = check(t, 'file:path=report=v1.txt', 'report=v1.txt');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PROMISEKEEPER_VERIFY_promise_test_SUCCESS/);
});

test('continues to accept an existing file without timestamp constraints', t => {
  const result = check(t, 'file:path=report.txt');
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('continues to reject a missing file', t => {
  const result = check(t, 'file:path=missing.txt');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /File missing.txt not found/);
});
