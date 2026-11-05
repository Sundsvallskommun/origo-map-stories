// Tests for store.runMigrations against the test database (TEST_DATABASE_URL
// or the UI tests' .runsettings). Each test migrates its own fresh schema, so
// the tables the other store tests use are not touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Client, Pool } = require('pg');
const store = require('../store');
const { testDatabaseUrl } = require('./helpers');

const url = testDatabaseUrl();
const skip = url ? false : 'TEST_DATABASE_URL is not set';
const SCHEMA = `oms_migration_test_${process.pid}`;
const MIGRATIONS = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(f => f.endsWith('.sql')).sort();
let db;

// public stays on the search path for the PostGIS types.
const schemaPool = () => new Pool({ connectionString: url, options: `-c search_path=${SCHEMA},public` });

// Collects console.log/console.warn output while fn runs.
async function captureConsole(fn) {
  const lines = { log: [], warn: [] };
  const original = { log: console.log, warn: console.warn };
  console.log = (...args) => lines.log.push(args.join(' '));
  console.warn = (...args) => lines.warn.push(args.join(' '));
  try {
    await fn();
  } finally {
    Object.assign(console, original);
  }
  return lines;
}

test.before(async () => {
  if (skip) return;
  db = new Client({ connectionString: url });
  await db.connect();
});

test.after(async () => {
  if (skip) return;
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
});

test.beforeEach(async () => {
  if (skip) return;
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.query(`CREATE SCHEMA ${SCHEMA}`);
});

test('two concurrent runs on a fresh schema apply each migration once', { skip }, async () => {
  const pools = [schemaPool(), schemaPool()];
  try {
    const { log } = await captureConsole(() => Promise.all(pools.map(p => store.runMigrations(p))));

    const applied = log.filter(line => line.startsWith('Applied migration ')).map(line => line.slice('Applied migration '.length));
    assert.deepEqual(applied.sort(), MIGRATIONS, 'every migration is applied exactly once');
    const { rows } = await db.query(`SELECT name FROM ${SCHEMA}.schema_migrations ORDER BY name`);
    assert.deepEqual(rows.map(r => r.name), MIGRATIONS);
    const { rows: tables } = await db.query('SELECT count(*) FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2', [SCHEMA, 'version']);
    assert.equal(Number(tables[0].count), 1, 'the schema was created in the fresh schema');
  } finally {
    await Promise.all(pools.map(p => p.end()));
  }
});

test('the migration lock is released after a run', { skip }, async () => {
  const pool = schemaPool();
  try {
    await captureConsole(() => store.runMigrations(pool));
    const { rows } = await db.query('SELECT pg_try_advisory_lock(73590000) AS locked');
    assert.equal(rows[0].locked, true, 'another session can take the lock');
    await db.query('SELECT pg_advisory_unlock(73590000)');
  } finally {
    await pool.end();
  }
});

test('migrations this build does not know are logged as a warning', { skip }, async () => {
  const pool = schemaPool();
  try {
    await captureConsole(() => store.runMigrations(pool));
    await db.query(`INSERT INTO ${SCHEMA}.schema_migrations (name) VALUES ('999_from_a_newer_version.sql')`);

    const { log, warn } = await captureConsole(() => store.runMigrations(pool));
    assert.deepEqual(log.filter(line => line.startsWith('Applied migration')), [], 'nothing new to apply');
    assert.equal(warn.length, 1);
    assert.match(warn[0], /migrations this build does not know: 999_from_a_newer_version\.sql/);
  } finally {
    await pool.end();
  }
});

test('no warning when the database has only known migrations', { skip }, async () => {
  const pool = schemaPool();
  try {
    await captureConsole(() => store.runMigrations(pool));
    const { warn } = await captureConsole(() => store.runMigrations(pool));
    assert.deepEqual(warn, []);
  } finally {
    await pool.end();
  }
});
