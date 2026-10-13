import type { Center } from '../../types/database';
import { getDonationSummary } from '../repo/donations';
import { listCenterUsers } from '../repo/users';
import { emailConfig, sendDonationEmails } from './send';

export interface NotifyInput {
  center: Center;
  itemId: string;
  amount: string;
  donorEmail: string | null;
}

export async function notifyDonation(input: NotifyInput): Promise<void> {
  try {
    if (!emailConfig()) return;
    const { center } = input;
    const [summary, users] = await Promise.all([
      getDonationSummary(center.id, input.itemId),
      center.notify_mode === 'each' ? listCenterUsers(center.id) : Promise.resolve([]),
    ]);
    if (!summary) return;
    await sendDonationEmails({
      data: {
        centerName: center.name,
        logoUrl: center.logo_url,
        primaryColor: center.primary_color,
        itemName: summary.name,
        amount: parseFloat(input.amount),
        goal: summary.goal,
        raised: summary.raised,
      },
      managerEmails: users.map((user) => user.email),
      donorEmail: input.donorEmail,
    });
  } catch (error) {
    console.error('Error preparando avisos por correo', error);
  }
}
