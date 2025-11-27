import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../pages/api/paypal/create-order';

const { mockSql } = vi.hoisted(() => {
    return { mockSql: vi.fn() };
});

vi.mock('../../lib/db', () => ({
    default: mockSql
}));

// Mock Fetch
global.fetch = vi.fn();

describe('POST /api/paypal/create-order', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Mock env vars
        vi.stubEnv('PAYPAL_CLIENT_ID', 'test_client_id');
        vi.stubEnv('PAYPAL_APP_SECRET', 'test_secret');
    });

    it('should return 400 if missing data', async () => {
        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({})
        });
        const response = await POST({ request } as any);
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain('Faltan datos');
    });

    it('should return 400 if amount is invalid', async () => {
        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ itemId: '1', amount: -5 })
        });
        const response = await POST({ request } as any);
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain('mayor o igual a 1');
    });

    it('should return 404 if item not found', async () => {
        mockSql.mockResolvedValue([]); // No items found

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ itemId: '999', amount: 10 })
        });
        const response = await POST({ request } as any);
        expect(response.status).toBe(404);
    });

    it('should return 400 if donation exceeds remaining goal', async () => {
        mockSql.mockResolvedValue([{
            id: '1',
            name: 'Test Item',
            goal_amount: '100',
            raised_amount: '90',
            status: 'active'
        }]);

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ itemId: '1', amount: 20 }) // Remaining is 10
        });
        const response = await POST({ request } as any);
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain('supera lo necesario');
    });

    it('should create order successfully', async () => {
        mockSql.mockResolvedValue([{
            id: '1',
            name: 'Test Item',
            goal_amount: '100',
            raised_amount: '50',
            status: 'active'
        }]);

        // Mock PayPal Token response
        (global.fetch as any)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ access_token: 'fake_token' })
            })
            // Mock PayPal Create Order response
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'ORDER-123' })
            });

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ itemId: '1', amount: 10 })
        });
        const response = await POST({ request } as any);

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.id).toBe('ORDER-123');
    });
});
