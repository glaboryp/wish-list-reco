import { formatEuro } from '../format';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface DonationEmailData {
  centerName: string;
  logoUrl: string | null;
  primaryColor: string;
  itemName: string;
  amount: number;
  goal: number;
  raised: number;
}

export const PRIVACY_NOTE =
  'Usamos tu correo solo para enviarte este agradecimiento: no lo guardamos ni lo compartimos.';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const stripBreaks = (value: string) => value.replace(/[\r\n]+/g, ' ');

function safeColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#007986';
}

function safeLogo(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? new URL(url).href : null;
  } catch {
    return null;
  }
}

export function goalStatus(data: Pick<DonationEmailData, 'goal' | 'raised'>): string {
  if (data.raised >= data.goal) return 'Objetivo alcanzado.';
  const percent = Math.floor((data.raised / data.goal) * 100);
  return `Llevamos ${formatEuro(data.raised)} de ${formatEuro(data.goal)} (${percent} %). Faltan ${formatEuro(data.goal - data.raised)}.`;
}

function layout(data: DonationEmailData, heading: string, paragraphs: string[], footer: string): string {
  const logo = safeLogo(data.logoUrl);
  const color = safeColor(data.primaryColor);
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;">${escapeHtml(p)}</p>`).join('');
  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
${logo ? `<img src="${escapeHtml(logo)}" alt="" height="48" style="display:block;margin:0 0 16px;max-height:48px;">` : ''}
<h1 style="margin:0 0 18px;font-size:22px;color:${color};">${escapeHtml(heading)}</h1>
${body}
<p style="margin:22px 0 0;font-size:13px;line-height:1.4;color:#6b7280;">${escapeHtml(footer)}</p>
</div></body></html>`;
}

export function managerEmail(data: DonationEmailData): EmailContent {
  const status = goalStatus(data);
  const lines = [
    `Se ha registrado una donación de ${formatEuro(data.amount)} para «${data.itemName}».`,
    status,
  ];
  const footer = `Recibes este aviso como encargada de ${data.centerName}. Puedes desactivarlo en el panel, en Avisos por correo.`;
  return {
    subject: stripBreaks(`Nueva donación de ${formatEuro(data.amount)} en ${data.centerName}`),
    html: layout(data, 'Nueva donación', lines, footer),
    text: `${lines.join('\n\n')}\n\n${footer}`,
  };
}

export function donorEmail(data: DonationEmailData): EmailContent {
  const lines = [
    `Hemos recibido tu donación de ${formatEuro(data.amount)} para «${data.itemName}». ¡Muchas gracias por tu generosidad!`,
    goalStatus(data),
  ];
  return {
    subject: stripBreaks(`Gracias por tu donación a ${data.centerName}`),
    html: layout(data, 'Gracias por tu donación', lines, `${data.centerName}. ${PRIVACY_NOTE}`),
    text: `${lines.join('\n\n')}\n\n${data.centerName}. ${PRIVACY_NOTE}`,
  };
}
