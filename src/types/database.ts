// Tipos para el esquema de base de datos

export type ItemStatus = 'draft' | 'active' | 'funded';

export interface DBItem {
  id: string; // UUID
  name: string;
  description: string | null;
  goal_amount: string; // NUMERIC viene como string desde Postgres
  raised_amount: string; // NUMERIC viene como string desde Postgres
  status: ItemStatus;
  sort_order: number;
  created_at: string; // TIMESTAMPTZ viene como string ISO
  updated_at: string;
}

export interface DBItemImage {
  id: string; // UUID
  item_id: string; // UUID
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  created_at: string;
}

// Tipo combinado para items con su imagen principal
export interface ItemWithImage extends DBItem {
  image_url: string | null;
  alt_text: string | null;
}

// Tipo para el frontend (con números en lugar de strings)
export interface WishlistItem {
  id: string;
  name: string;
  description: string;
  goal: number;
  raised: number;
  imageUrl: string | null;
  imageAlt: string | null;
  status: ItemStatus;
}
