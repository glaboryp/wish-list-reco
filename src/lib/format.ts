const euro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

export const formatEuro = (amount: number): string => euro.format(amount);
