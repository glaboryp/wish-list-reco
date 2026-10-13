import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import { ImageTooLargeError, MAX_UPLOAD_BYTES, computeTargetSize, isProcessable, optimizeImage, toWebpName } from '../../lib/image-resize';

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
    afterEach(() => vi.unstubAllGlobals());

    const stubBrowser = (bitmapSize: { width: number; height: number }, encoded: Blob | null) => {
        const bitmap = {
            ...bitmapSize,
            close: vi.fn(function (this: { width: number; height: number }) {
                this.width = 0;
                this.height = 0;
            }),
        };
        vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
        vi.stubGlobal('document', {
            createElement: () => ({
                getContext: () => ({ drawImage: vi.fn() }),
                toBlob: (callback: (blob: Blob | null) => void) => callback(encoded),
            }),
        });
        return bitmap;
    };

    it('returns the original file when the type is not processable', async () => {
        const gif = new File(['x'], 'a.gif', { type: 'image/gif' });
        expect(await optimizeImage(gif)).toBe(gif);
    });

    it('falls back to the original file when decoding fails and it fits the upload cap', async () => {
        const png = new File(['x'], 'a.png', { type: 'image/png' });
        expect(await optimizeImage(png)).toBe(png);
    });

    it('keeps a small WebP whose re-encode would be larger', async () => {
        const original = new File(['x'.repeat(100)], 'a.webp', { type: 'image/webp' });
        const bitmap = stubBrowser({ width: 800, height: 600 }, new Blob(['y'.repeat(500)], { type: 'image/webp' }));
        expect(await optimizeImage(original)).toBe(original);
        expect(bitmap.close).toHaveBeenCalled();
    });

    it('replaces the file with the re-encoded WebP when it is smaller', async () => {
        const original = new File(['x'.repeat(500)], 'a.jpg', { type: 'image/jpeg' });
        stubBrowser({ width: 800, height: 600 }, new Blob(['y'.repeat(50)], { type: 'image/webp' }));
        const result = await optimizeImage(original);
        expect(result.name).toBe('a.webp');
        expect(result.type).toBe('image/webp');
    });

    it('rejects with ImageTooLargeError when decoding fails on a file over the cap', async () => {
        const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' });
        vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('out of memory'); }));
        await expect(optimizeImage(big)).rejects.toBeInstanceOf(ImageTooLargeError);
    });

    it('rejects with ImageTooLargeError when WebP encoding is unsupported on a file over the cap', async () => {
        const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' });
        stubBrowser({ width: 4000, height: 3000 }, new Blob(['p'], { type: 'image/png' }));
        await expect(optimizeImage(big)).rejects.toBeInstanceOf(ImageTooLargeError);
    });
});
