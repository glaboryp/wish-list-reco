import { describe, expect, it } from 'vitest';
import { buildDonationsCsv, csvCell, formatCsvAmount } from '../../lib/csv';
import type { DonationRow } from '../../types/database';

const row = (overrides: Partial<DonationRow> = {}): DonationRow => ({
    id: 'd1',
    item_id: 'i1',
    item_name: 'Cáliz',
    amount: '10.5',
    fee_amount: '0.66',
    refunded_amount: '0',
    refunded_at: null,
    currency: 'EUR',
    source: 'paypal',
    note: 'nota privada',
    voided_at: null,
    voided_by: null,
    void_reason: null,
    created_at: '2025-07-14T23:30:00Z',
    ...overrides,
});

describe('csvCell', () => {
    it('leaves plain text alone', () => {
        expect(csvCell('Cáliz')).toBe('Cáliz');
    });

    it('quotes separators, quotes and line breaks', () => {
        expect(csvCell('a;b')).toBe('"a;b"');
        expect(csvCell('di "hola"')).toBe('"di ""hola"""');
        expect(csvCell('a\nb')).toBe('"a\nb"');
        expect(csvCell(' espacio')).toBe('" espacio"');
    });

    it.each(['=1+1', '+34 600', '-5', '@SUM(A1)'])('neutralizes formula prefix in %s', (value) => {
        expect(csvCell(value)).toBe(`'${value}`);
    });

    it('neutralizes and quotes when both apply', () => {
        expect(csvCell('=A1;B1')).toBe('"\'=A1;B1"');
    });
});

describe('formatCsvAmount', () => {
    it('uses two decimals and a comma', () => {
        expect(formatCsvAmount('10.5')).toBe('10,50');
        expect(formatCsvAmount(0)).toBe('0,00');
    });
});

describe('buildDonationsCsv', () => {
    it('starts with a BOM and the header, uses ; and CRLF', () => {
        const csv = buildDonationsCsv([]);
        expect(csv).toBe('﻿Fecha;Artículo;Importe neto;Comisión;Reembolsado;Neto tras reembolsos;Origen;Estado;Motivo de anulación\r\n');
    });

    it('writes a live PayPal donation in Madrid time without personal notes', () => {
        const [, line] = buildDonationsCsv([row()]).trimEnd().split('\r\n');
        expect(line).toMatch(/^"?15\/7\/25,? 1:30"?;Cáliz;10,50;0,66;0,00;10,50;PayPal;vigente;$/);
        expect(line).not.toContain('nota privada');
    });

    it('marks voided donations with their reason', () => {
        const [, line] = buildDonationsCsv([row({ source: 'manual', fee_amount: '0', voided_at: '2025-07-15T10:00:00Z', void_reason: 'reembolso; error' })]).trimEnd().split('\r\n');
        expect(line).toContain(';0,00;0,00;Manual;anulada;"reembolso; error"');
    });

    it('shows a partial refund and what is left counting for the item', () => {
        const [, line] = buildDonationsCsv([row({ amount: '10.00', refunded_amount: '5.00', refunded_at: '2025-07-20T10:00:00Z' })]).trimEnd().split('\r\n');
        expect(line).toContain(';10,00;0,66;5,00;5,00;PayPal;reembolso parcial;');
    });

    it('guards against formula injection in item names', () => {
        const csv = buildDonationsCsv([row({ item_name: '=HYPERLINK("x")' })]);
        expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    });
});
