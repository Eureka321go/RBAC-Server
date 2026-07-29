import type { Database } from '../ports/index';

export class VoiceHeardStore {
  constructor(private readonly db: Database) {}

  async isHeard(accountId: number, cid: string, seq: number): Promise<boolean> {
    const rows = await this.db.query<{ heard_at: number }>(
      `SELECT heard_at FROM voice_heard WHERE account_id = ? AND cid = ? AND seq = ?`,
      [accountId, cid, seq],
    );
    return rows.length > 0;
  }

  async markHeard(accountId: number, cid: string, seq: number): Promise<void> {
    await this.db.exec(
      `INSERT INTO voice_heard (account_id, cid, seq, heard_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id, cid, seq) DO UPDATE SET heard_at = excluded.heard_at`,
      [accountId, cid, seq, Date.now()],
    );
  }

  async listHeardSeqs(accountId: number, cid: string): Promise<Set<number>> {
    const rows = await this.db.query<{ seq: number }>(
      `SELECT seq FROM voice_heard WHERE account_id = ? AND cid = ?`,
      [accountId, cid],
    );
    return new Set(rows.map((row) => row.seq));
  }
}
