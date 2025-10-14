export interface WishlistItem {
  id: string;
  name: string;
  description: string;
  goal: number;
  raised: number;
}

export const items: WishlistItem[] = [
  {
    id: 'chalice-01',
    name: 'Nuevo Cáliz',
    description: 'Un vaso sagrado para la Eucaristía.',
    goal: 300,
    raised: 50,
  },
  {
    id: 'paten-resto-01',
    name: 'Restauración de Patena',
    description: 'Restaurando el baño de oro.',
    goal: 150,
    raised: 75,
  },
  // Añadir más artículos...
];
