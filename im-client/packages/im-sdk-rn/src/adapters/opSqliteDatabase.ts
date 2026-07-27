import { open, type DB } from '@op-engineering/op-sqlite';
import type { Database, Row, SqlValue } from '@im/sdk-core';

/** core 的 Database 端口在 RN 上的实现；SQL 与 sql.js/better-sqlite3 共享同一套脚本。 */
export class OpSqliteDatabase implements Database {
  private constructor(private readonly db: DB) {}

  static open(name = 'im.db'): OpSqliteDatabase {
    return new OpSqliteDatabase(open({ name }));
  }

  async exec(sql: string, params: SqlValue[] = []): Promise<void> {
    // SqlValue 是 Scalar 的子集（无 boolean/ArrayBuffer），结构上可直接赋值，无需断言。
    await this.db.execute(sql, params);
  }

  async query<T = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const res = await this.db.execute(sql, params);
    // 当前锁定版本 @op-engineering/op-sqlite@17.1.2：QueryResult.rows 直接是
    // Record<string, Scalar>[] 数组形态（非旧版 { _array } 包装），无需拆包。
    // 转成调用方指定的 T 需要经过 unknown：T 是无约束的泛型，Scalar 也宽于
    // core 的 SqlValue，这里的行为与 core 测试用的 sql.js 适配器同构（同样用
    // as unknown as T 完成这一步，而非放过一个真实的形态不符）。
    return res.rows as unknown as T[];
  }

  /** 与 sql.js 适配器同构：显式 BEGIN/COMMIT，异常回滚后原样抛出。 */
  async tx(fn: (tx: Database) => Promise<void>): Promise<void> {
    await this.exec('BEGIN');
    try {
      await fn(this);
      await this.exec('COMMIT');
    } catch (e) {
      try {
        await this.exec('ROLLBACK');
      } catch {
        // 回滚失败也不能盖掉原始异常——原始异常才是调用方要看的根因。
      }
      throw e;
    }
  }
}
