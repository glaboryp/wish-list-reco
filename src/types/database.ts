import type { FeeSchedule } from '../lib/fees';

export type ItemStatus = 'draft' | 'active' | 'funded' | 'archived';
export type CenterStatus = 'active' | 'disabled';
export type PayPalEnv = 'sandbox' | 'live';

export interface Center {
  id: string;
  slug: string;
  name: string;
  status: CenterStatus;
  hero_title: string;
  hero_text: string;
  hero_image_url: string | null;
  logo_url: string | null;
  primary_color: string;
  paypal_client_id: string | null;
  paypal_env: PayPalEnv;
  paypal_configured: boolean;
  fees: FeeSchedule;
  created_at: string;
  updated_at: string;
}

export interface FeeSettingsInput {
  paypalPercent: number;
  paypalFixed: number;
  cardPercent: number;
  cardFixed: number;
}

export interface CenterWithSecret extends Center {
  paypal_secret_encrypted: string | null;
}

export interface DBItem {
  id: string;
  center_id: string;
  name: string;
  description: string | null;
  goal_amount: string;
  status: ItemStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ItemRow extends DBItem {
  raised_amount: string;
  image_url: string | null;
  alt_text: string | null;
}

export interface DBItemImage {
  id: string;
  item_id: string;
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  created_at: string;
}

export interface WishlistItem {
  id: string;
  name: string;
  description: string;
  goal: number;
  raised: number;
  imageUrl: string | null;
  imageAlt: string | null;
  status: 'active' | 'funded';
}

export interface AdminItem {
  id: string;
  name: string;
  description: string;
  goal: number;
  raised: number;
  status: ItemStatus;
  sortOrder: number;
  imageUrl: string | null;
  imageAlt: string | null;
  donationCount: number;
  blockingDonationCount: number;
}

export interface ItemInput {
  name: string;
  description: string;
  goal: number;
  status: 'draft' | 'active' | 'archived';
  sortOrder: number;
  imageUrl: string | null;
}

export interface AppearanceInput {
  name: string;
  heroTitle: string;
  heroText: string;
  primaryColor: string;
  heroImageUrl: string | null;
  logoUrl: string | null;
  removeHeroImage: boolean;
  removeLogo: boolean;
}

export interface PayPalSettingsInput {
  clientId: string;
  env: PayPalEnv;
  secretEncrypted: string | null;
}

export interface DonationRow {
  id: string;
  item_id: string;
  item_name: string;
  amount: string;
  fee_amount: string;
  currency: string;
  source: 'paypal' | 'manual';
  note: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface CenterUserRow {
  email: string;
  firebase_uid: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  center_id: string | null;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: string;
}
