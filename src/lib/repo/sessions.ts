import sql from '../db';

export async function getSessionVersion(email: string): Promise<number> {
  const rows = await sql`SELECT session_version FROM user_sessions WHERE email = ${email.toLowerCase()}`;
  return rows.length > 0 ? Number(rows[0].session_version) : 0;
}

export async function bumpSessionVersion(email: string): Promise<number> {
  const rows = await sql`
    INSERT INTO user_sessions (email, session_version) VALUES (${email.toLowerCase()}, 1)
    ON CONFLICT (email) DO UPDATE SET session_version = user_sessions.session_version + 1
    RETURNING session_version
  `;
  return Number(rows[0]?.session_version ?? 1);
}
