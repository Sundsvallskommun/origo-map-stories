const test = require('node:test');
const assert = require('node:assert/strict');
const { version: packageVersion } = require('../../package.json');

// No database needed: /api/version only reads the environment and package.json.
const app = require('../server');

async function getVersion() {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/version`);
    return { status: res.status, cacheControl: res.headers.get('cache-control'), body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// Sets the given variables (undefined = unset) for the duration of fn.
async function withEnv(vars, fn) {
  const previous = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  const set = values => Object.entries(values).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  set(vars);
  try {
    return await fn();
  } finally {
    set(previous);
  }
}

test('GET /api/version returns BUILD_SHA and APP_VERSION without auth', async () => {
  await withEnv({ BUILD_SHA: 'abc123', APP_VERSION: '1.2.3' }, async () => {
    const { status, cacheControl, body } = await getVersion();
    assert.equal(status, 200);
    assert.equal(cacheControl, 'no-store');
    assert.deepEqual(body, { sha: 'abc123', version: '1.2.3' });
  });
});

test('GET /api/version falls back to dev and the package.json version', async () => {
  await withEnv({ BUILD_SHA: undefined, APP_VERSION: undefined }, async () => {
    assert.match(packageVersion, /^\d+\.\d+\.\d+/);
    assert.deepEqual((await getVersion()).body, { sha: 'dev', version: packageVersion });
  });
});
