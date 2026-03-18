/**
 * Audit Logger - records system actions for compliance and traceability
 */

import { Pool } from 'pg';
import { AuditEntry } from '../types';

export class AuditLogger {
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (actor, action, resource, details, outcome)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.actor, entry.action, entry.resource, JSON.stringify(entry.details), entry.outcome]
    );
  }

  async query(filters: {
    actor?: string;
    action?: string;
    since?: Date;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filters.actor) {
      conditions.push(`actor = $${idx++}`);
      params.push(filters.actor);
    }

    if (filters.action) {
      conditions.push(`action LIKE $${idx++}`);
      params.push(`%${filters.action}%`);
    }

    if (filters.since) {
      conditions.push(`timestamp >= $${idx++}`);
      params.push(filters.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await this.pool.query(
      `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT $${idx}`,
      [...params, filters.limit || 100]
    );

    return result.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
