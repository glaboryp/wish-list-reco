import type { ItemRow, WishlistItem } from '../types/database';

export function toWishlistItem(row: ItemRow): WishlistItem {
  const goal = parseFloat(row.goal_amount);
  const raised = parseFloat(row.raised_amount);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    goal,
    raised,
    donorCount: Number(row.donor_count ?? 0),
    imageUrl: row.image_url,
    imageAlt: row.alt_text,
    status: raised >= goal ? 'funded' : 'active',
  };
}

export function sortForPublic(items: WishlistItem[]): WishlistItem[] {
  return [
    ...items.filter((item) => item.status === 'active'),
    ...items.filter((item) => item.status === 'funded'),
  ];
}
