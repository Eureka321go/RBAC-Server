import { describe, it, expect } from 'vitest';
import { runMigrations } from '../src/index';
import { createSqljsDatabase } from './support/sqljsDatabase';

describe('migrations', () => {
  it('creates conversations/messages/sync_meta tables', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);

    const tables = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    );
    const names = tables.map((t) => t.name);
    expect(names).toContain('conversations');
    expect(names).toContain('messages');
    expect(names).toContain('sync_meta');
  });

  it('creates the (cid, client_msg_id) index on messages', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const idx = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_messages_cid_client'`,
    );
    expect(idx.length).toBe(1);
  });

  it('is idempotent (second run is a no-op)', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    await runMigrations(db); // 不应抛错
    const rows = await db.query<{ version: number }>(
      `SELECT version FROM _migrations ORDER BY version`,
    );
    expect(rows.length).toBe(4);
  });
});
