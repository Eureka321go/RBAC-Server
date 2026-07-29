import initSqlJs, { type Database as SqlJsDb, type SqlValue as JsVal } from 'sql.js';
import type { Database, SqlValue } from '../../src/ports/index';

/** sql.js 是同步 WASM 库；这里包成 core 的 Promise 化 Database 端口（仅测试用）。 */
class SqljsDatabase implements Database {
  constructor(private readonly db: SqlJsDb) {}

  async exec(sql: string, params: SqlValue[] = []): Promise<void> {
    this.db.run(sql, params as JsVal[]);
  }

  async query<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as JsVal[]);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as T);
    }
    stmt.free();
    return rows;
  }

  async tx(fn: (tx: Database) => Promise<void>): Promise<void> {
    this.db.run('BEGIN');
    try {
      await fn(this);
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
  }
}

export async function createSqljsDatabase(): Promise<Database> {
  const SQL = await initSqlJs();
  return new SqljsDatabase(new SQL.Database());
}
