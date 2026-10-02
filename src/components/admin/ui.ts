const control =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 text-base font-semibold transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50';

export const inputClass =
  'w-full min-h-11 rounded-lg border border-line-strong bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';
export const labelClass = 'block text-base font-semibold text-ink mb-1.5';
export const helpClass = 'mt-1.5 text-sm text-muted';
export const buttonClass = `${control} bg-brand text-white hover:bg-brand-hover`;
export const secondaryButtonClass = `${control} border border-line-strong bg-white text-ink hover:bg-surface`;
export const dangerButtonClass = `${control} border border-red-700 bg-white text-red-800 hover:bg-red-50`;
export const linkClass = 'font-semibold text-brand underline-offset-4 hover:underline';
export const cardClass = 'rounded-xl border border-line bg-white p-5 shadow-card sm:p-6';
export const formFooterClass = 'flex flex-wrap items-center gap-3 border-t border-line pt-5';

const chip = 'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-semibold';
export const chipClass = {
  ok: `${chip} bg-green-100 text-green-900`,
  info: `${chip} bg-brand-soft text-brand-hover`,
  warn: `${chip} bg-amber-100 text-amber-900`,
  muted: `${chip} bg-gray-100 text-gray-700`,
};

export const tableClass = 'stack-table w-full text-left text-base';
export const thClass = 'py-2 pr-4 text-sm font-semibold text-muted';
export const tdClass = 'py-3.5 pr-4 align-middle';
export const rowDividerClass = 'divide-y divide-line';
