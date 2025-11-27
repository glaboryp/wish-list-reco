import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../pages/api/paypal/capture-order';

const { mockSql } = vi.hoisted(() => {
    return { mockSql: vi.fn() };
});

vi.mock('../../lib/db', () => ({
    default: mockSql
}));

// Mock Fetch
global.fetch = vi.fn();

describe('POST /api/paypal/capture-order', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('PAYPAL_CLIENT_ID', 'test_client_id');
        vi.stubEnv('PAYPAL_APP_SECRET', 'test_secret');
    });

    it('should return 400 if orderID is missing', async () => {
        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({})
        });
        const response = await POST({ request } as any);
        expect(response.status).toBe(400);
    });

    it('should return 500 if PayPal token fails', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: false,
            text: async () => 'Error',
            status: 401
        });

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ orderID: '123' })
        });
        const response = await POST({ request } as any);
        expect(response.status).toBe(500);
    });

    it('should return 500 if capture fails', async () => {
        // Token success
        (global.fetch as any)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ access_token: 'fake_token' })
            })
            // Capture fail
            .mockResolvedValueOnce({
                ok: false,
                status: 400,
                json: async () => ({})
            });

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ orderID: '123' })
        });
        const response = await POST({ request } as any);
        expect(response.status).toBe(500);
    });

    it('should process successful capture and update DB', async () => {
        // Token success
        (global.fetch as any)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ access_token: 'fake_token' })
            })
            // Capture success
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    status: 'COMPLETED',
                    purchase_units: [{
                        payments: {
                            captures: [{
                                amount: { value: '10.00', currency_code: 'EUR' },
                                custom_id: '1'
                            }]
                        }
                    }]
                })
            });

        // Mock DB update
        mockSql.mockResolvedValue([{
            id: '1',
            name: 'Test Item',
            raised_amount: '60',
            goal_amount: '100',
            status: 'active'
        }]);

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ orderID: 'ORDER-123' })
        });
        const response = await POST({ request } as any);

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.ok).toBe(true);
        expect(data.amount).toBe('10.00');
        expect(mockSql).toHaveBeenCalled();
    });
});
