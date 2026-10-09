import sql from '../db';
import type { AuditEntry } from '../../types/database';

export interface AuditInput {
  centerId: string | null;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
}

export const AUDIT_PAGE_SIZE = 50;

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await sql`
      INSERT INTO audit_log (center_id, actor_email, action, entity_type, entity_id, summary)
      VALUES (${input.centerId}, ${input.actorEmail}, ${input.action}, ${input.entityType}, ${input.entityId ?? null}, ${input.summary})
    `;
  } catch (err) {
    console.error('Audit log write failed:', input.action, err instanceof Error ? err.message : 'unknown error');
  }
}

export async function listAudit(
  centerId: string,
  page: number,
): Promise<{ rows: AuditEntry[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * AUDIT_PAGE_SIZE;
  const [rows, count] = await Promise.all([
    sql`
      SELECT id, center_id, actor_email, action, entity_type, entity_id, summary, created_at
      FROM audit_log WHERE center_id = ${centerId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${AUDIT_PAGE_SIZE} OFFSET ${offset}
    `,
    sql`SELECT COUNT(*) AS total FROM audit_log WHERE center_id = ${centerId}`,
  ]);
  return { rows: rows as AuditEntry[], total: Number(count[0]?.total ?? 0) };
}
