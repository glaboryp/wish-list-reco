import { donorEmail, managerEmail, type DonationEmailData, type EmailContent } from './templates';

const ENDPOINT = 'https://api.resend.com/emails';
export const SEND_TIMEOUT_MS = 4000;

let warnedUnconfigured = false;

interface EmailConfig {
  apiKey: string;
  from: string;
}

export function emailConfig(): EmailConfig | null {
  const apiKey = import.meta.env.RESEND_API_KEY;
  const from = import.meta.env.EMAIL_FROM;
  if (!apiKey || !from) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.info('RESEND_API_KEY o EMAIL_FROM sin configurar: los avisos por correo están desactivados');
    }
    return null;
  }
  return { apiKey, from };
}

async function sendEmail(config: EmailConfig, to: string[], content: EmailContent): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.from, to, subject: content.subject, html: content.html, text: content.text }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
}

export interface DonationEmailInput {
  data: DonationEmailData;
  managerEmails: string[];
  donorEmail: string | null;
}

export async function sendDonationEmails(input: DonationEmailInput): Promise<void> {
  const config = emailConfig();
  if (!config) return;

  const jobs: Promise<void>[] = [];
  if (input.managerEmails.length > 0) jobs.push(sendEmail(config, input.managerEmails, managerEmail(input.data)));
  if (input.donorEmail) jobs.push(sendEmail(config, [input.donorEmail], donorEmail(input.data)));

  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === 'rejected') console.error('Error enviando aviso por correo', result.reason);
  }
}
