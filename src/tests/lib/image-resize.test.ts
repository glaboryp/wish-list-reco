import { describe, expect, it } from 'vitest';
import { computeTargetSize, isProcessable, optimizeImage, toWebpName } from '../../lib/image-resize';

describe('computeTargetSize', () => {
    it('keeps images that already fit', () => {
        expect(computeTargetSize(800, 600)).toEqual({ width: 800, height: 600 });
        expect(computeTargetSize(1600, 1200)).toEqual({ width: 1600, height: 1200 });
    });

    it('scales landscape images by the longest side', () => {
        expect(computeTargetSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    });

    it('scales portrait images by the longest side', () => {
        expect(computeTargetSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    });

    it('never returns a zero dimension', () => {
        expect(computeTargetSize(100000, 10).height).toBe(1);
    });
});

describe('helpers', () => {
    it('only processes static raster types', () => {
        expect(isProcessable('image/jpeg')).toBe(true);
        expect(isProcessable('image/gif')).toBe(false);
    });

    it('renames to .webp', () => {
        expect(toWebpName('foto.final.JPG')).toBe('foto.final.webp');
        expect(toWebpName('foto')).toBe('foto.webp');
    });
});

describe('optimizeImage', () => {
    it('returns the original file when the type is not processable', async () => {
        const gif = new File(['x'], 'a.gif', { type: 'image/gif' });
        expect(await optimizeImage(gif)).toBe(gif);
    });

    it('falls back to the original file when decoding fails', async () => {
        const png = new File(['x'], 'a.png', { type: 'image/png' });
        expect(await optimizeImage(png)).toBe(png);
    });
});
