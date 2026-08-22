import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(testsDirectory);
const migrationsDirectory = join(repositoryRoot, 'drizzle');
const metadataDirectory = join(migrationsDirectory, 'meta');

const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .map((name) => join(migrationsDirectory, name));

const migrationTag = (migrationPath) => basename(migrationPath, '.sql');
const migrationNumber = (migrationPath) => migrationTag(migrationPath).slice(0, 4);
const readJson = (name) => JSON.parse(readFileSync(join(metadataDirectory, name), 'utf8'));
const journal = readJson('_journal.json');
const snapshots = migrationFiles.map((migrationPath) => readJson(`${migrationNumber(migrationPath)}_snapshot.json`));

function migrationStatements(migrationPath) {
  return readFileSync(migrationPath, 'utf8')
    .split(/--> statement-breakpoint/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function applyMigration(database, migrationPath) {
  for (const statement of migrationStatements(migrationPath)) database.exec(statement);
}

function applyMigrations(database, migrations = migrationFiles) {
  for (const migrationPath of migrations) applyMigration(database, migrationPath);
}

function primaryKeyColumns(database, tableName) {
  return database
    .prepare(`PRAGMA table_info(\`${tableName}\`)`)
    .all()
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
}

function tableNames(database) {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((table) => table.name);
}

function assertNamedIndexes(database, tableName, expectedIndexes) {
  const actualIndexes = database
    .prepare(`PRAGMA index_list(\`${tableName}\`)`)
    .all()
    .map((index) => index.name);

  for (const expectedIndex of expectedIndexes) assert.ok(actualIndexes.includes(expectedIndex), `${tableName} is missing ${expectedIndex}`);
}

test('Drizzle metadata is a contiguous chain through migration 0004', () => {
  assert.equal(journal.version, '7');
  assert.equal(journal.dialect, 'sqlite');
  assert.equal(journal.entries.length, migrationFiles.length);
  assert.deepEqual(journal.entries.map((entry) => entry.idx), migrationFiles.map((_, index) => index));
  assert.deepEqual(journal.entries.map((entry) => entry.tag), migrationFiles.map(migrationTag));

  for (const [index, entry] of journal.entries.entries()) {
    assert.equal(entry.version, '6');
    assert.equal(entry.breakpoints, true);
    assert.equal(snapshots[index].version, '6');
    assert.equal(snapshots[index].dialect, 'sqlite');
    assert.equal(
      snapshots[index].prevId,
      index === 0 ? '00000000-0000-0000-0000-000000000000' : snapshots[index - 1].id,
    );
  }
});

test('0004 snapshot records sandbox-scoped composite primary keys', () => {
  const snapshot = snapshots.at(-1);
  assert.equal(snapshot.prevId, snapshots.at(-2).id);

  assert.deepEqual(snapshot.tables.sandbox_command_records.compositePrimaryKeys, {
    sandbox_command_records_sandbox_id_operation_id_pk: {
      columns: ['sandbox_id', 'operation_id'],
      name: 'sandbox_command_records_sandbox_id_operation_id_pk',
    },
  });
  assert.deepEqual(snapshot.tables.sandbox_preview_records.compositePrimaryKeys, {
    sandbox_preview_records_sandbox_id_preview_id_pk: {
      columns: ['sandbox_id', 'preview_id'],
      name: 'sandbox_preview_records_sandbox_id_preview_id_pk',
    },
  });
  assert.equal(snapshot.tables.sandbox_command_records.columns.operation_id.primaryKey, false);
  assert.equal(snapshot.tables.sandbox_preview_records.columns.preview_id.primaryKey, false);
});

test('all migrations apply to an empty SQLite database', () => {
  const database = new DatabaseSync(':memory:');
  try {
    applyMigrations(database);
    assert.deepEqual(tableNames(database), Object.keys(snapshots.at(-1).tables).sort());
    assert.deepEqual(primaryKeyColumns(database, 'sandbox_command_records'), ['sandbox_id', 'operation_id']);
    assert.deepEqual(primaryKeyColumns(database, 'sandbox_preview_records'), ['sandbox_id', 'preview_id']);
  } finally {
    database.close();
  }
});

test('0003 data upgrades through 0004 and allows sandbox-scoped duplicate keys', () => {
  const database = new DatabaseSync(':memory:');
  try {
    applyMigrations(database, migrationFiles.slice(0, -1));
    assert.deepEqual(primaryKeyColumns(database, 'sandbox_command_records'), ['operation_id']);
    assert.deepEqual(primaryKeyColumns(database, 'sandbox_preview_records'), ['preview_id']);

    database.exec(`
      INSERT INTO sandbox_command_records
        (operation_id, sandbox_id, actor_id, command, mode, idempotency_key, request_id, command_id, payload_hash, state_version_before, state_version_after, status, result_json, created_at, expires_at)
      VALUES
        ('op-shared', 'sandbox-a', 'actor-a', 'listing.create', 'commit', 'idem-a', NULL, NULL, 'hash-a', 0, 1, 'succeeded', '{}', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
      INSERT INTO sandbox_preview_records
        (preview_id, sandbox_id, actor_id, command, payload_json, payload_hash, base_state_version, summary_json, status, created_at, virtual_expires_at, retention_expires_at, committed_operation_id)
      VALUES
        ('preview-shared', 'sandbox-a', 'actor-a', 'listing.create', '{}', 'hash-a', 0, '{}', 'active', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', '2026-01-02T00:00:00Z', NULL);
    `);

    applyMigration(database, migrationFiles.at(-1));
    assert.deepEqual(primaryKeyColumns(database, 'sandbox_command_records'), ['sandbox_id', 'operation_id']);
    assert.deepEqual(primaryKeyColumns(database, 'sandbox_preview_records'), ['sandbox_id', 'preview_id']);
    assertNamedIndexes(database, 'sandbox_command_records', [
      'sandbox_command_records_idempotency_idx',
      'sandbox_command_records_sandbox_idx',
    ]);
    assertNamedIndexes(database, 'sandbox_preview_records', [
      'sandbox_preview_records_sandbox_idx',
      'sandbox_preview_records_retention_idx',
    ]);

    database.exec(`
      INSERT INTO sandbox_command_records
        (operation_id, sandbox_id, actor_id, command, mode, idempotency_key, request_id, command_id, payload_hash, state_version_before, state_version_after, status, result_json, created_at, expires_at)
      VALUES
        ('op-shared', 'sandbox-b', 'actor-b', 'listing.create', 'commit', 'idem-b', NULL, NULL, 'hash-b', 0, 1, 'succeeded', '{}', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
      INSERT INTO sandbox_preview_records
        (preview_id, sandbox_id, actor_id, command, payload_json, payload_hash, base_state_version, summary_json, status, created_at, virtual_expires_at, retention_expires_at, committed_operation_id)
      VALUES
        ('preview-shared', 'sandbox-b', 'actor-b', 'listing.create', '{}', 'hash-b', 0, '{}', 'active', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', '2026-01-02T00:00:00Z', NULL);
    `);

    assert.deepEqual(
      database
        .prepare("SELECT sandbox_id, operation_id FROM sandbox_command_records WHERE operation_id = 'op-shared' ORDER BY sandbox_id")
        .all()
        .map((row) => ({ sandbox_id: row.sandbox_id, operation_id: row.operation_id })),
      [
        { sandbox_id: 'sandbox-a', operation_id: 'op-shared' },
        { sandbox_id: 'sandbox-b', operation_id: 'op-shared' },
      ],
    );
    assert.deepEqual(
      database
        .prepare("SELECT sandbox_id, preview_id FROM sandbox_preview_records WHERE preview_id = 'preview-shared' ORDER BY sandbox_id")
        .all()
        .map((row) => ({ sandbox_id: row.sandbox_id, preview_id: row.preview_id })),
      [
        { sandbox_id: 'sandbox-a', preview_id: 'preview-shared' },
        { sandbox_id: 'sandbox-b', preview_id: 'preview-shared' },
      ],
    );
  } finally {
    database.close();
  }
});
