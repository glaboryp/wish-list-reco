import nodemailer from 'nodemailer';
import { donorEmail, managerEmail, type DonationEmailData, type EmailContent } from './templates';

const ENDPOINT = 'https://api.resend.com/emails';
export const SEND_TIMEOUT_MS = 4000;

let warnedUnconfigured = false;

export interface EmailTransport {
  send(to: string[], content: EmailContent): Promise<void>;
}

function resendTransport(apiKey: string, from: string): EmailTransport {
  return {
    async send(to, content) {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject: content.subject, html: content.html, text: content.text }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    },
  };
}

function smtpTransport(user: string, password: string, from: string): EmailTransport {
  const port = Number(import.meta.env.SMTP_PORT) || 465;
  const transporter = nodemailer.createTransport({
    host: import.meta.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass: password },
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
  return {
    async send(to, content) {
      await transporter.sendMail({ from, to, subject: content.subject, html: content.html, text: content.text });
    },
  };
}

export function emailConfig(): EmailTransport | null {
  const apiKey = import.meta.env.RESEND_API_KEY;
  const from = import.meta.env.EMAIL_FROM;
  if (apiKey && from) return resendTransport(apiKey, from);

  const user = import.meta.env.SMTP_USER;
  const password = import.meta.env.SMTP_PASSWORD;
  if (user && password) return smtpTransport(user, password, from || `Listas de deseos <${user}>`);

  if (!warnedUnconfigured) {
    warnedUnconfigured = true;
    console.info('Correo sin configurar (RESEND_API_KEY + EMAIL_FROM, o SMTP_USER + SMTP_PASSWORD): los avisos por correo están desactivados');
  }
  return null;
}

export interface DonationEmailInput {
  data: DonationEmailData;
  managerEmails: string[];
  donorEmail: string | null;
}

export async function sendDonationEmails(input: DonationEmailInput): Promise<void> {
  const transport = emailConfig();
  if (!transport) return;

  const jobs: Promise<void>[] = [];
  if (input.managerEmails.length > 0) jobs.push(transport.send(input.managerEmails, managerEmail(input.data)));
  if (input.donorEmail) jobs.push(transport.send([input.donorEmail], donorEmail(input.data)));

  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === 'rejected') console.error('Error enviando aviso por correo', result.reason);
  }
}
