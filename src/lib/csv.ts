import { formatDateTime } from './format';
import type { DonationRow } from '../types/database';

const BOM = '﻿';
const SEPARATOR = ';';
const EOL = '\r\n';

export const DONATIONS_CSV_HEADER = ['Fecha', 'Artículo', 'Importe neto', 'Comisión', 'Origen', 'Estado', 'Motivo de anulación'];

export function csvCell(value: string): string {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[;"\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function formatCsvAmount(value: string | number): string {
    return Number(value).toFixed(2).replace('.', ',');
}

export function buildDonationsCsv(rows: DonationRow[]): string {
    const lines = [
        DONATIONS_CSV_HEADER,
        ...rows.map((row) => [
            formatDateTime(row.created_at),
            row.item_name,
            formatCsvAmount(row.amount),
            formatCsvAmount(row.fee_amount),
            row.source === 'paypal' ? 'PayPal' : 'Manual',
            row.voided_at ? 'anulada' : 'vigente',
            row.voided_at ? (row.void_reason ?? '') : '',
        ]),
    ];
    return BOM + lines.map((line) => line.map(csvCell).join(SEPARATOR)).join(EOL) + EOL;
}
