import sql from '../db';
import { discardBlobs } from './blobs';
import { feeScheduleFromRow } from '../fees';
import type {
  AppearanceInput,
  Center,
  CenterStatus,
  CenterWithSecret,
  FeeSettingsInput,
  NotifySettingsInput,
  PayPalSettingsInput,
} from '../../types/database';

function toCenter(row: any): Center {
  const {
    paypal_secret_encrypted,
    paypal_fee_percent,
    paypal_fee_fixed,
    card_fee_percent,
    card_fee_fixed,
    ...rest
  } = row;
  return {
    ...rest,
    paypal_configured: Boolean(paypal_secret_encrypted && rest.paypal_client_id),
    fees: feeScheduleFromRow({ paypal_fee_percent, paypal_fee_fixed, card_fee_percent, card_fee_fixed }),
  };
}

export async function listCenters(): Promise<Center[]> {
  const rows = await sql`SELECT * FROM centers ORDER BY name ASC`;
  return rows.map(toCenter);
}

export async function listActiveCenters(): Promise<Center[]> {
  const rows = await sql`SELECT * FROM centers WHERE status = 'active' ORDER BY name ASC`;
  return rows.map(toCenter);
}

export async function getCenterBySlug(slug: string): Promise<Center | null> {
  const rows = await sql`SELECT * FROM centers WHERE slug = ${slug} LIMIT 1`;
  return rows.length > 0 ? toCenter(rows[0]) : null;
}

export async function getCenterWithSecret(slug: string): Promise<CenterWithSecret | null> {
  const rows = await sql`SELECT * FROM centers WHERE slug = ${slug} LIMIT 1`;
  if (rows.length === 0) return null;
  return { ...toCenter(rows[0]), paypal_secret_encrypted: rows[0].paypal_secret_encrypted };
}

export async function createCenter(input: { slug: string; name: string }): Promise<Center | null> {
  const rows = await sql`
    INSERT INTO centers (slug, name, hero_title)
    VALUES (${input.slug}, ${input.name}, ${input.name})
    ON CONFLICT (slug) DO NOTHING
    RETURNING *
  `;
  return rows.length > 0 ? toCenter(rows[0]) : null;
}

export async function updateAppearance(centerId: string, input: AppearanceInput): Promise<void> {
  const rows = await sql`
    WITH old AS (SELECT hero_image_url, logo_url FROM centers WHERE id = ${centerId})
    UPDATE centers SET
      name = ${input.name},
      hero_title = ${input.heroTitle},
      hero_text = ${input.heroText},
      primary_color = ${input.primaryColor},
      hero_image_url = CASE WHEN ${input.removeHeroImage}::boolean THEN NULL ELSE COALESCE(${input.heroImageUrl}, hero_image_url) END,
      logo_url = CASE WHEN ${input.removeLogo}::boolean THEN NULL ELSE COALESCE(${input.logoUrl}, logo_url) END,
      updated_at = NOW()
    WHERE id = ${centerId}
    RETURNING (SELECT hero_image_url FROM old) AS old_hero, (SELECT logo_url FROM old) AS old_logo
  `;
  if (rows.length > 0) await discardBlobs([rows[0].old_hero, rows[0].old_logo]);
}

export async function setCenterStatus(centerId: string, status: CenterStatus): Promise<void> {
  await sql`UPDATE centers SET status = ${status}, updated_at = NOW() WHERE id = ${centerId}`;
}

export async function updateFeeSettings(centerId: string, input: FeeSettingsInput): Promise<void> {
  await sql`
    UPDATE centers SET
      paypal_fee_percent = ${input.paypalPercent},
      paypal_fee_fixed = ${input.paypalFixed},
      card_fee_percent = ${input.cardPercent},
      card_fee_fixed = ${input.cardFixed},
      updated_at = NOW()
    WHERE id = ${centerId}
  `;
}

export async function updateNotifySettings(centerId: string, input: NotifySettingsInput): Promise<void> {
  await sql`UPDATE centers SET notify_mode = ${input.mode}, updated_at = NOW() WHERE id = ${centerId}`;
}

export async function updatePaypal(centerId: string, input: PayPalSettingsInput): Promise<void> {
  await sql`
    UPDATE centers SET
      paypal_client_id = ${input.clientId},
      paypal_env = ${input.env},
      paypal_secret_encrypted = COALESCE(${input.secretEncrypted}, paypal_secret_encrypted),
      updated_at = NOW()
    WHERE id = ${centerId}
  `;
}
