const euro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

export const formatEuro = (amount: number): string => euro.format(amount);

const dateTime = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Madrid',
});

export const formatDateTime = (value: Date | string): string => dateTime.format(new Date(value));

export const formatDonorCount = (count: number): string | null => {
  if (count <= 0) return null;
  return count === 1 ? '1 persona ha donado' : `${count} personas han donado`;
};
