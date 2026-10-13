import { describe, expect, it } from 'vitest';
import { paypalSdkUrl } from '../../lib/paypal-sdk';

describe('paypalSdkUrl', () => {
    it('requests the buttons component in EUR', () => {
        const url = new URL(paypalSdkUrl('abc'));
        expect(url.origin + url.pathname).toBe('https://www.paypal.com/sdk/js');
        expect(url.searchParams.get('client-id')).toBe('abc');
        expect(url.searchParams.get('currency')).toBe('EUR');
        expect(url.searchParams.get('components')).toBe('buttons');
    });

    it('encodes the client id', () => {
        expect(new URL(paypalSdkUrl('a&b=c')).searchParams.get('client-id')).toBe('a&b=c');
    });
});
