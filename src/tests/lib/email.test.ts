import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getDonationSummary, listCenterUsers } = vi.hoisted(() => ({ getDonationSummary: vi.fn(), listCenterUsers: vi.fn() }));
vi.mock('../../lib/repo/donations', () => ({ getDonationSummary }));
vi.mock('../../lib/repo/users', () => ({ listCenterUsers }));

import { notifyDonation } from '../../lib/email/notify';
import { sendDonationEmails } from '../../lib/email/send';
import { donorEmail, escapeHtml, managerEmail, PRIVACY_NOTE } from '../../lib/email/templates';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const data = {
  centerName: 'Recoletos <b>',
  logoUrl: 'https://x.public.blob.vercel-storage.com/recoletos/logo.png',
  primaryColor: '#007986',
  itemName: 'Cáliz "<script>"',
  amount: 10,
  goal: 100,
  raised: 25,
};

const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('EMAIL_FROM', 'Avisos <avisos@example.org>');
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => vi.unstubAllEnvs());

describe('templates', () => {
  it('escapes every interpolated value in the html and keeps it raw in the text', () => {
    const { html, text, subject } = managerEmail(data);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('Recoletos <b>');
    expect(html).toContain('Cáliz &quot;&lt;script&gt;&quot;');
    expect(text).toContain('«Cáliz "<script>"»');
    expect(subject).toContain('10,00');
  });

  it('shows the goal status and the funded state', () => {
    expect(managerEmail(data).text).toContain('25 %');
    expect(managerEmail({ ...data, raised: 100 }).text).toContain('Objetivo alcanzado');
  });

  it('includes the privacy line in the donor thank-you only', () => {
    expect(donorEmail(data).html).toContain(escapeHtml(PRIVACY_NOTE));
    expect(donorEmail(data).text).toContain(PRIVACY_NOTE);
    expect(managerEmail(data).text).not.toContain(PRIVACY_NOTE);
  });

  it('drops non-https logos and invalid colors', () => {
    const html = donorEmail({ ...data, logoUrl: 'javascript:alert(1)', primaryColor: 'red;x' }).html;
    expect(html).not.toContain('<img');
    expect(html).not.toContain('red;x');
  });
});

describe('sendDonationEmails', () => {
  it('sends nothing when the provider is not configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    await sendDonationEmails({ data, managerEmails: ['m@example.org'], donorEmail: 'd@example.org' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the manager and donor emails through Resend', async () => {
    await sendDonationEmails({ data, managerEmails: ['m@example.org', 'n@example.org'], donorEmail: 'd@example.org' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer re_test');
    expect(bodyOf(0)).toMatchObject({ from: 'Avisos <avisos@example.org>', to: ['m@example.org', 'n@example.org'] });
    expect(bodyOf(1).to).toEqual(['d@example.org']);
  });

  it('skips the donor email when PayPal gave no address, and managers when there are none', async () => {
    await sendDonationEmails({ data, managerEmails: [], donorEmail: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('only logs failures and still sends the other email', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(
      sendDonationEmails({ data, managerEmails: ['m@example.org'], donorEmail: 'd@example.org' }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe('notifyDonation', () => {
  const center = { id: 'c1', name: 'Recoletos', logo_url: null, primary_color: '#007986', notify_mode: 'each' } as any;
  const input = { center, itemId: 'i1', amount: '10.00', donorEmail: 'd@example.org' };

  beforeEach(() => {
    getDonationSummary.mockResolvedValue({ name: 'Cáliz', goal: 100, raised: 25 });
    listCenterUsers.mockResolvedValue([{ email: 'm@example.org' }]);
  });

  it('emails the center users and the donor', async () => {
    await notifyDonation(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(0).to).toEqual(['m@example.org']);
  });

  it('skips managers when notifications are off but still thanks the donor', async () => {
    await notifyDonation({ ...input, center: { ...center, notify_mode: 'none' } });
    expect(listCenterUsers).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(0).to).toEqual(['d@example.org']);
  });

  it('never throws, even if the database fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDonationSummary.mockRejectedValue(new Error('db down'));
    await expect(notifyDonation(input)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('does not touch the database when email is not configured', async () => {
    vi.stubEnv('EMAIL_FROM', '');
    await notifyDonation(input);
    expect(getDonationSummary).not.toHaveBeenCalled();
  });
});
