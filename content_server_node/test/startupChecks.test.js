// Startup checks in server.js: production secrets and the development
// database guard. Each test starts server.js as a child process; the checks run
// before the database is touched, and DATABASE_URL points at a closed port so a
// server that passes them fails fast on the connection instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'server.js');
const GOOD_SECRET = 'k3J9xq2LwVb7Rt5Yn8Mz4Pc6Hd1Fs0Ga'; // 32 characters
const GOOD_PASSWORD = 'a-real-admin-password';
const UNREACHABLE_DB = 'postgres://user:pw@127.0.0.1:1/origo_map_stories';
const SECRET_REFUSAL = /Refusing to start in production/;
const DB_REFUSAL = /Refusing to start \(OMS_STRICT_DEV_DB=1\)/;
const DB_WARNING = /WARNING: the database 'origo_map_stories' does not end with _dev, _test or _local/;
const REACHED_DATABASE = /Failed to start content server/;

// Empty strings (rather than leaving variables out) also keep dotenv from
// filling them in from a developer's content_server_node/.env.
function run(env) {
  const base = { ...process.env };
  ['pm_id', 'BUILD_SHA', 'APP_VERSION'].forEach(k => delete base[k]);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      env: {
        ...base,
        NODE_ENV: '',
        JWT_SECRET: '',
        ADMIN_PASSWORD: '',
        ALLOW_INSECURE_DEFAULTS: '',
        OMS_STRICT_DEV_DB: '',
        DATABASE_URL: UNREACHABLE_DB,
        DB_STARTUP_MAX_ATTEMPTS: '1',
        PORT: '0',
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`server.js did not exit:\n${output}`)); }, 30000);
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

const production = env => run({ NODE_ENV: 'production', JWT_SECRET: GOOD_SECRET, ADMIN_PASSWORD: GOOD_PASSWORD, ...env });

// ─── Production secrets ──────────────────────────────────────────────────────

test('production refuses to start without JWT_SECRET and ADMIN_PASSWORD', async () => {
  const { code, output } = await production({ JWT_SECRET: '', ADMIN_PASSWORD: '' });
  assert.equal(code, 1);
  assert.match(output, SECRET_REFUSAL);
  assert.match(output, /JWT_SECRET is not set/);
  assert.match(output, /ADMIN_PASSWORD is not set/);
  assert.doesNotMatch(output, REACHED_DATABASE, 'exits before connecting to the database');
});

for (const placeholder of ['fallback-secret', 'change-me-to-a-long-random-string-xxxxxxxxx', 'changeme', 'replace-with-a-long-random-string-xxxxxxxx', '<long random string, at least 32 characters>']) {
  test(`production refuses the placeholder JWT_SECRET "${placeholder}"`, async () => {
    const { code, output } = await production({ JWT_SECRET: placeholder });
    assert.equal(code, 1);
    assert.match(output, /JWT_SECRET is still a placeholder value/);
    assert.ok(!output.includes(placeholder), 'the value is never printed');
  });
}

for (const placeholder of ['changeme', 'change-me', 'replace-with-admin-password', '<admin password>']) {
  test(`production refuses the placeholder ADMIN_PASSWORD "${placeholder}"`, async () => {
    const { code, output } = await production({ ADMIN_PASSWORD: placeholder });
    assert.equal(code, 1);
    assert.match(output, /ADMIN_PASSWORD is still a placeholder value/);
    assert.ok(!output.includes(placeholder), 'the value is never printed');
  });
}

test('production refuses a JWT_SECRET shorter than 32 characters', async () => {
  const short = GOOD_SECRET.slice(0, 31);
  const { code, output } = await production({ JWT_SECRET: short });
  assert.equal(code, 1);
  assert.match(output, /JWT_SECRET is shorter than 32 characters/);
  assert.ok(!output.includes(short), 'the value is never printed');
});

test('production with real secrets passes the checks and goes on to the database', async () => {
  const { code, output } = await production({});
  assert.equal(code, 1, 'the database is unreachable');
  assert.doesNotMatch(output, SECRET_REFUSAL);
  assert.doesNotMatch(output, DB_WARNING, 'the development database guard does not apply in production');
  assert.match(output, REACHED_DATABASE);
  assert.ok(!output.includes(GOOD_SECRET) && !output.includes(GOOD_PASSWORD), 'secrets are never printed');
});

test('ALLOW_INSECURE_DEFAULTS=1 starts anyway with a loud warning', async () => {
  const { code, output } = await production({ JWT_SECRET: '', ADMIN_PASSWORD: 'changeme', ALLOW_INSECURE_DEFAULTS: '1' });
  assert.equal(code, 1, 'the database is unreachable');
  assert.match(output, /INSECURE: starting in production anyway because ALLOW_INSECURE_DEFAULTS=1/);
  assert.match(output, /JWT_SECRET is not set/);
  assert.match(output, /ADMIN_PASSWORD is still a placeholder value/);
  assert.doesNotMatch(output, SECRET_REFUSAL);
  assert.match(output, REACHED_DATABASE);
});

test('outside production missing secrets are allowed (development defaults)', async () => {
  const { output } = await run({ DATABASE_URL: 'postgres://user:pw@127.0.0.1:1/origo_map_stories_dev' });
  assert.doesNotMatch(output, SECRET_REFUSAL);
  assert.doesNotMatch(output, /INSECURE/);
  assert.match(output, REACHED_DATABASE);
});

// ─── Development database guard ──────────────────────────────────────────────

test('development against a database without _dev/_test/_local warns but starts', async () => {
  const { code, output } = await run({ NODE_ENV: 'development' });
  assert.equal(code, 1, 'the database is unreachable');
  assert.match(output, DB_WARNING);
  assert.doesNotMatch(output, DB_REFUSAL);
  assert.match(output, REACHED_DATABASE);
});

test('OMS_STRICT_DEV_DB=1 refuses to start against such a database', async () => {
  const { code, output } = await run({ OMS_STRICT_DEV_DB: '1' });
  assert.equal(code, 1);
  assert.match(output, DB_REFUSAL);
  assert.doesNotMatch(output, REACHED_DATABASE, 'exits before connecting to the database');
  assert.ok(!output.includes('user:pw'), 'credentials in DATABASE_URL are never printed');
});

for (const database of ['origo_map_stories_dev', 'origo_map_stories_test', 'origo_map_stories_local']) {
  test(`development against ${database} starts without a warning, even with OMS_STRICT_DEV_DB=1`, async () => {
    const { output } = await run({ OMS_STRICT_DEV_DB: '1', DATABASE_URL: `postgres://user:pw@127.0.0.1:1/${database}` });
    assert.doesNotMatch(output, /WARNING: the database/);
    assert.doesNotMatch(output, DB_REFUSAL);
    assert.match(output, REACHED_DATABASE);
  });
}
