import type { Database } from '../ports/index';

/** 每项单条 SQL；跨 sql.js / op-sqlite / better-sqlite3 一致。 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE conversations (
     cid TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     group_id INTEGER,
     last_msg_seq INTEGER NOT NULL DEFAULT 0,
     last_msg_preview TEXT,
     last_read_seq INTEGER NOT NULL DEFAULT 0,
     peer_read_seq INTEGER,
     mention_seq INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE messages (
     cid TEXT NOT NULL,
     seq INTEGER NOT NULL,
     msg_id TEXT,
     client_msg_id TEXT,
     sender_id INTEGER,
     type TEXT NOT NULL,
     body_json TEXT,
     recalled INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'sent',
     ts INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (cid, seq)
   )`,
  `CREATE TABLE sync_meta (
     cid TEXT PRIMARY KEY,
     synced_seq INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX idx_messages_cid_client ON messages (cid, client_msg_id)`,
  `CREATE TABLE outbox (
     client_msg_id TEXT PRIMARY KEY,
     cid TEXT NOT NULL,
     type TEXT NOT NULL,
     body_json TEXT,
     status TEXT NOT NULL,
     error TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX idx_outbox_cid_created ON outbox (cid, created_at)`,
  `ALTER TABLE conversations ADD COLUMN peer_id INTEGER`,
  `ALTER TABLE conversations ADD COLUMN peer_name TEXT`,
  `ALTER TABLE conversations ADD COLUMN display_name TEXT`,
];

/** 幂等：用 _migrations 表记录已应用版本，可重复调用。 */
export async function runMigrations(db: Database): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  );
  const applied = await db.query<{ version: number }>(
    `SELECT version FROM _migrations`,
  );
  const done = new Set(applied.map((r) => r.version));

  for (let version = 0; version < MIGRATIONS.length; version++) {
    if (done.has(version)) continue;
    const sql = MIGRATIONS[version];
    await db.tx(async (tx) => {
      await tx.exec(sql);
      await tx.exec(`INSERT INTO _migrations (version, applied_at) VALUES (?, ?)`, [
        version,
        Date.now(),
      ]);
    });
  }
}
