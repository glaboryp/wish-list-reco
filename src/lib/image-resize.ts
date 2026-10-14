export const MAX_IMAGE_SIDE = 1600;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const WEBP_QUALITY = 0.82;
const PROCESSABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function computeTargetSize(width: number, height: number, maxSide = MAX_IMAGE_SIDE) {
    const longest = Math.max(width, height);
    if (longest <= maxSide) return { width, height };
    const scale = maxSide / longest;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function isProcessable(type: string) {
    return PROCESSABLE_TYPES.includes(type);
}

export function toWebpName(name: string) {
    return name.replace(/\.[^.]+$/, '') + '.webp';
}

export class ImageTooLargeError extends Error {
    constructor() {
        super('La imagen es demasiado grande y no se ha podido reducir.');
        this.name = 'ImageTooLargeError';
    }
}

function keepOriginal(file: File): File {
    if (file.size > MAX_UPLOAD_BYTES) throw new ImageTooLargeError();
    return file;
}

export async function optimizeImage(file: File, maxSide = MAX_IMAGE_SIDE): Promise<File> {
    if (!isProcessable(file.type) || typeof createImageBitmap !== 'function') return keepOriginal(file);

    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const sourceWidth = bitmap.width;
        const sourceHeight = bitmap.height;
        const { width, height } = computeTargetSize(sourceWidth, sourceHeight, maxSide);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
            bitmap.close();
            return keepOriginal(file);
        }
        context.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
        if (!blob || blob.type !== 'image/webp') return keepOriginal(file);
        if (blob.size >= file.size && file.type === 'image/webp' && width === sourceWidth && height === sourceHeight) return keepOriginal(file);

        return new File([blob], toWebpName(file.name), { type: 'image/webp' });
    } catch (error) {
        if (error instanceof ImageTooLargeError) throw error;
        return keepOriginal(file);
    }
}
