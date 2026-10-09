interface GalleryImage {
    src: string;
    alt: string;
}

const SWIPE_THRESHOLD = 50;
const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])';

function onSwipe(target: HTMLElement, handler: (direction: 1 | -1) => void): { swiped: () => boolean } {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let didSwipe = false;

    target.addEventListener('pointerdown', (event) => {
        tracking = true;
        didSwipe = false;
        startX = event.clientX;
        startY = event.clientY;
    });
    target.addEventListener('pointercancel', () => (tracking = false));
    target.addEventListener('pointerup', (event) => {
        if (!tracking) return;
        tracking = false;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        didSwipe = true;
        handler(dx < 0 ? 1 : -1);
    });

    return { swiped: () => didSwipe };
}

export function initGallery(root: HTMLElement): void {
    const images: GalleryImage[] = JSON.parse(root.dataset.images ?? '[]');
    const mainImage = root.querySelector<HTMLImageElement>('[data-gallery-image]');
    const opener = root.querySelector<HTMLButtonElement>('[data-gallery-open]');
    const thumbs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-gallery-thumb]'));
    if (!images.length || !mainImage || !opener) return;

    let index = 0;
    const wrap = (value: number) => (value + images.length) % images.length;

    const lightbox = buildLightbox(images.length > 1);
    const lightboxImage = lightbox.querySelector<HTMLImageElement>('[data-lightbox-image]')!;
    const counter = lightbox.querySelector<HTMLElement>('[data-lightbox-counter]')!;
    let previousFocus: HTMLElement | null = null;

    function show(next: number) {
        index = wrap(next);
        const { src, alt } = images[index];
        mainImage!.src = src;
        mainImage!.alt = alt;
        lightboxImage.src = src;
        lightboxImage.alt = alt;
        counter.textContent = `${index + 1} de ${images.length}`;
        thumbs.forEach((thumb, position) => thumb.setAttribute('aria-pressed', String(position === index)));
    }

    function open() {
        previousFocus = document.activeElement as HTMLElement | null;
        show(index);
        document.body.appendChild(lightbox);
        document.body.style.overflow = 'hidden';
        lightbox.querySelector<HTMLElement>('[data-lightbox-close]')!.focus();
        document.addEventListener('keydown', onKeydown);
    }

    function close() {
        document.removeEventListener('keydown', onKeydown);
        lightbox.remove();
        document.body.style.overflow = '';
        previousFocus?.focus();
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        } else if (event.key === 'ArrowRight' && images.length > 1) {
            show(index + 1);
        } else if (event.key === 'ArrowLeft' && images.length > 1) {
            show(index - 1);
        } else if (event.key === 'Tab') {
            const focusable = Array.from(lightbox.querySelectorAll<HTMLElement>(FOCUSABLE));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (!lightbox.contains(active)) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        }
    }

    thumbs.forEach((thumb, position) => thumb.addEventListener('click', () => show(position)));

    const mainSwipe = onSwipe(opener, (direction) => show(index + direction));
    opener.addEventListener('click', () => {
        if (!mainSwipe.swiped()) open();
    });

    const stage = lightbox.querySelector<HTMLElement>('[data-lightbox-stage]')!;
    const stageSwipe = onSwipe(stage, (direction) => show(index + direction));
    lightbox.querySelector('[data-lightbox-close]')!.addEventListener('click', close);
    lightbox.querySelector('[data-lightbox-prev]')?.addEventListener('click', () => show(index - 1));
    lightbox.querySelector('[data-lightbox-next]')?.addEventListener('click', () => show(index + 1));
    lightbox.addEventListener('click', (event) => {
        if ((event.target === lightbox || event.target === stage) && !stageSwipe.swiped()) close();
    });
}

function buildLightbox(withNavigation: boolean): HTMLElement {
    const caret = (direction: 'left' | 'right') =>
        `<svg viewBox="0 0 256 256" width="28" height="28" fill="currentColor" aria-hidden="true" focusable="false"><path d="${
            direction === 'left'
                ? 'M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z'
                : 'M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z'
        }"/></svg>`;
    const buttonClass = 'flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/30';

    const el = document.createElement('div');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Galería de imágenes');
    el.className = 'fixed inset-0 z-50 flex flex-col select-none bg-black/90';
    el.addEventListener('dragstart', (event) => event.preventDefault());
    el.innerHTML = `
        <div class="flex items-center justify-between px-4 py-3 text-white" style="padding-top:max(.75rem, env(safe-area-inset-top))">
            <span data-lightbox-counter class="tabular text-base" aria-live="polite"></span>
            <button type="button" data-lightbox-close class="${buttonClass}" aria-label="Cerrar galería">
                <svg viewBox="0 0 256 256" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>
            </button>
        </div>
        <div data-lightbox-stage class="relative flex min-h-0 flex-1 items-center justify-center px-2" style="touch-action:pan-y">
            <img data-lightbox-image alt="" class="pointer-events-none max-h-full max-w-full select-none object-contain" draggable="false" />
            ${
                withNavigation
                    ? `<button type="button" data-lightbox-prev class="${buttonClass} absolute left-3 top-1/2 -translate-y-1/2" aria-label="Imagen anterior">${caret('left')}</button>
            <button type="button" data-lightbox-next class="${buttonClass} absolute right-3 top-1/2 -translate-y-1/2" aria-label="Imagen siguiente">${caret('right')}</button>`
                    : ''
            }
        </div>
        <div class="h-4" style="padding-bottom:env(safe-area-inset-bottom)"></div>`;
    return el;
}
