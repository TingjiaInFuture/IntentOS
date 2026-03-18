/**
 * Email Worker - drains queued emails from email_outbox and sends them via SMTP
 */

import { Pool } from 'pg';
import * as nodemailer from 'nodemailer';
import { SystemConfig } from '../types';

const emailPoolCache = new Map<string, Pool>();

function getEmailPool(connectionString: string): Pool {
  const existing = emailPoolCache.get(connectionString);
  if (existing) {
    return existing;
  }

  const pool = new Pool({ connectionString });
  emailPoolCache.set(connectionString, pool);
  return pool;
}

export class EmailWorker {
  private pool: Pool;
  private transporter: nodemailer.Transporter;
  private fromAddress: string;
  private interval: NodeJS.Timeout | null = null;

  constructor(databaseUrl: string, smtpConfig: NonNullable<SystemConfig['smtp']>) {
    this.pool = getEmailPool(databaseUrl);
    this.fromAddress = smtpConfig.from;
    this.transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.port === 465,
      auth: smtpConfig.user ? { user: smtpConfig.user, pass: smtpConfig.pass } : undefined,
    });
  }

  start(intervalMs: number = 10000): void {
    if (this.interval) {
      return;
    }

    this.interval = setInterval(() => {
      void this.runOnce().catch((error) => {
        console.error('Email worker error:', error);
      });
    }, intervalMs);

    void this.runOnce().catch((error) => {
      console.error('Email worker error:', error);
    });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async runOnce(): Promise<number> {
    let processedCount = 0;

    while (await this.processNextEmail()) {
      processedCount++;
    }

    return processedCount;
  }

  async close(): Promise<void> {
    this.stop();
    await this.pool.end();
  }

  private async processNextEmail(): Promise<boolean> {
    const client = await this.pool.connect();
    let email: any | undefined;

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `SELECT * FROM email_outbox
         WHERE status = 'queued'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`
      );

      if (result.rowCount === 0) {
        await client.query('COMMIT');
        return false;
      }

      email = result.rows[0];
      await client.query(`UPDATE email_outbox SET status = 'sending' WHERE id = $1`, [email.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    try {
      const recipient = await this.pool.query(
        `SELECT email FROM employees WHERE id::text = $1 LIMIT 1`,
        [email.recipient_id]
      );
      const toAddress = recipient.rows[0]?.email || email.recipient_id;

      await this.transporter.sendMail({
        from: this.fromAddress,
        to: toAddress,
        subject: email.subject || 'IntentOS Notification',
        text: email.body || '',
      });

      await this.pool.query(`UPDATE email_outbox SET status = 'sent', sent_at = NOW() WHERE id = $1`, [
        email.id,
      ]);

      if (email.notification_id) {
        await this.pool.query(`UPDATE notifications SET status = 'sent' WHERE id = $1`, [
          email.notification_id,
        ]);
      }
    } catch (error) {
      await this.pool.query(`UPDATE email_outbox SET status = 'failed' WHERE id = $1`, [email.id]);
      if (email.notification_id) {
        await this.pool.query(`UPDATE notifications SET status = 'failed' WHERE id = $1`, [
          email.notification_id,
        ]);
      }
      console.error('Failed to send email outbox message:', error);
    }

    return true;
  }
}

export function createEmailWorker(
  databaseUrl: string,
  smtpConfig: NonNullable<SystemConfig['smtp']>
): EmailWorker {
  return new EmailWorker(databaseUrl, smtpConfig);
}