import { isCenterBlobUrl } from '../blob';
import { isValidPrimaryColor } from '../color';
import { isUuid } from '../ids';
import { validateSlug } from '../slug';
import type { AppearanceInput, ItemInput, PayPalEnv } from '../../types/database';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PayPalFormInput {
  clientId: string;
  env: PayPalEnv;
  secret: string | null;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const text = (form: FormData, name: string): string => String(form.get(name) ?? '').trim();

const MONEY_PATTERN = /^\d{1,7}([.,]\d{1,2})?$/;
const INTEGER_PATTERN = /^-?\d{1,6}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAYPAL_CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;
const MAX_AMOUNT = 1_000_000;

function parseMoney(raw: string): number | null {
  if (!MONEY_PATTERN.test(raw)) return null;
  const value = Number(raw.replace(',', '.'));
  return value > 0 && value <= MAX_AMOUNT ? value : null;
}

function blobField(form: FormData, name: string, slug: string): { ok: true; value: string | null } | { ok: false } {
  const raw = text(form, name);
  if (raw === '') return { ok: true, value: null };
  return isCenterBlobUrl(raw, slug) ? { ok: true, value: new URL(raw).href } : { ok: false };
}

export function parseEmail(raw: unknown): Parsed<string> {
  const email = String(raw ?? '').trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return fail('Escribe un correo electrónico válido, por ejemplo nombre@gmail.com');
  }
  return { ok: true, value: email };
}

export function parseAppearance(form: FormData, slug: string): Parsed<AppearanceInput> {
  const name = text(form, 'name');
  if (!name || name.length > 80) return fail('El nombre es obligatorio (máximo 80 caracteres)');

  const heroTitle = text(form, 'hero_title');
  if (heroTitle.length > 200) return fail('El título admite como máximo 200 caracteres');

  const heroText = text(form, 'hero_text').replace(/\r\n/g, '\n');
  if (heroText.length > 4000) return fail('El texto admite como máximo 4000 caracteres');

  const primaryColor = text(form, 'primary_color').toLowerCase();
  if (!isValidPrimaryColor(primaryColor)) {
    return fail('Ese color es demasiado claro: el texto blanco de los botones no se leería. Elige uno más oscuro');
  }

  const heroImage = blobField(form, 'hero_image_url', slug);
  const logo = blobField(form, 'logo_url', slug);
  if (!heroImage.ok || !logo.ok) return fail('No se pudo usar la imagen. Vuelve a elegirla y espera a que aparezca «Imagen lista»');

  return {
    ok: true,
    value: { name, heroTitle, heroText, primaryColor, heroImageUrl: heroImage.value, logoUrl: logo.value },
  };
}

export function parseItem(form: FormData, slug: string): Parsed<ItemInput> {
  const name = text(form, 'name');
  if (!name || name.length > 120) return fail('El nombre es obligatorio (máximo 120 caracteres)');

  const description = text(form, 'description').replace(/\r\n/g, '\n');
  if (description.length > 2000) return fail('La descripción admite como máximo 2000 caracteres');

  const goal = parseMoney(text(form, 'goal'));
  if (goal === null) return fail('El precio debe ser un importe mayor que 0, con coma o punto para los céntimos (por ejemplo 120,50)');

  const status = text(form, 'status');
  if (status !== 'draft' && status !== 'active' && status !== 'archived') return fail('La visibilidad elegida no es válida');

  const sortRaw = text(form, 'sort_order');
  if (sortRaw !== '' && !INTEGER_PATTERN.test(sortRaw)) return fail('La posición debe ser un número entero (0, 1, 2...)');

  const image = blobField(form, 'image_url', slug);
  if (!image.ok) return fail('No se pudo usar la imagen. Vuelve a elegirla y espera a que aparezca «Imagen lista»');

  return {
    ok: true,
    value: {
      name,
      description,
      goal,
      status,
      sortOrder: sortRaw === '' ? 0 : Number(sortRaw),
      imageUrl: image.value,
    },
  };
}

export function parseManualDonation(form: FormData): Parsed<{ itemId: string; amount: number; note: string }> {
  const itemId = text(form, 'item_id');
  if (!isUuid(itemId)) return fail('Elige un artículo');

  const amount = parseMoney(text(form, 'amount'));
  if (amount === null) return fail('El importe debe ser mayor que 0, con coma o punto para los céntimos (por ejemplo 20,50)');

  const note = text(form, 'note');
  if (note.length > 200) return fail('La nota admite como máximo 200 caracteres');

  return { ok: true, value: { itemId, amount, note } };
}

export function parsePaypal(form: FormData): Parsed<PayPalFormInput> {
  const clientId = text(form, 'client_id');
  if (!PAYPAL_CLIENT_ID_PATTERN.test(clientId)) return fail('El Client ID de PayPal no es válido');

  const env = text(form, 'env');
  if (env !== 'sandbox' && env !== 'live') return fail('El entorno de PayPal no es válido');

  const secret = text(form, 'secret');
  if (secret !== '' && !/^\S{1,300}$/.test(secret)) return fail('El secret de PayPal no es válido');

  return { ok: true, value: { clientId, env, secret: secret === '' ? null : secret } };
}

export function parseNewCenter(form: FormData): Parsed<{ slug: string; name: string }> {
  const slug = text(form, 'slug').toLowerCase();
  const slugError = validateSlug(slug);
  if (slugError) return fail(slugError);

  const name = text(form, 'name');
  if (!name || name.length > 80) return fail('El nombre es obligatorio (máximo 80 caracteres)');

  return { ok: true, value: { slug, name } };
}
