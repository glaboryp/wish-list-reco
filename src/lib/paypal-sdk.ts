export function paypalSdkUrl(clientId: string): string {
    return `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=capture&disable-funding=paylater&components=buttons`;
}
