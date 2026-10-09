import sql from '../db';
import type { CenterUserRow } from '../../types/database';

export async function findMembership(centerId: string, email: string): Promise<boolean> {
  const rows = await sql`SELECT 1 AS ok FROM center_users WHERE center_id = ${centerId} AND email = ${email}`;
  return rows.length > 0;
}

export async function listMembershipsByEmail(email: string): Promise<{ slug: string; name: string }[]> {
  const rows = await sql`
    SELECT c.slug, c.name
    FROM center_users cu JOIN centers c ON c.id = cu.center_id
    WHERE cu.email = ${email}
    ORDER BY c.name ASC
  `;
  return rows as { slug: string; name: string }[];
}

export async function linkFirebaseUid(email: string, uid: string): Promise<void> {
  await sql`UPDATE center_users SET firebase_uid = ${uid} WHERE email = ${email} AND firebase_uid IS NULL`;
}

export async function listCenterUsers(centerId: string): Promise<CenterUserRow[]> {
  const rows = await sql<CenterUserRow>`
    SELECT email, firebase_uid, created_at FROM center_users
    WHERE center_id = ${centerId} ORDER BY created_at ASC
  `;
  return rows;
}

export async function addCenterUser(centerId: string, email: string): Promise<boolean> {
  const rows = await sql`
    INSERT INTO center_users (center_id, email) VALUES (${centerId}, ${email})
    ON CONFLICT (center_id, email) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

export async function removeCenterUser(
  centerId: string,
  email: string,
  options: { force?: boolean } = {},
): Promise<'removed' | 'last' | 'missing'> {
  const removed = options.force
    ? await sql`DELETE FROM center_users WHERE center_id = ${centerId} AND email = ${email} RETURNING id`
    : await sql`
        DELETE FROM center_users
        WHERE center_id = ${centerId} AND email = ${email}
          AND (SELECT count(*) FROM center_users WHERE center_id = ${centerId}) > 1
        RETURNING id
      `;
  if (removed.length > 0) return 'removed';
  const exists = await sql`SELECT 1 AS ok FROM center_users WHERE center_id = ${centerId} AND email = ${email}`;
  return exists.length > 0 ? 'last' : 'missing';
}
