export function initDonateBar(bar: HTMLElement, target: HTMLElement): void {
    const button = bar.querySelector<HTMLButtonElement>('button')!;
    let finished = false;

    const setVisible = (visible: boolean) => {
        bar.classList.toggle('hidden', !visible);
        bar.setAttribute('aria-hidden', String(!visible));
    };

    const observer = new IntersectionObserver(([entry]) => setVisible(!finished && !entry.isIntersecting), { threshold: 0 });
    observer.observe(target);

    button.addEventListener('click', () => {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.querySelector<HTMLElement>('input[name="amount"]')?.focus({ preventScroll: true });
    });

    document.addEventListener('donation:completed', () => {
        finished = true;
        setVisible(false);
    });
}
