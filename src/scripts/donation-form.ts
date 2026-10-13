import { amountWithFees, type FeeSchedule, type PaymentSource } from '../lib/fees';

interface PayPalActions {
    resolve: () => Promise<void>;
    reject: () => Promise<void>;
}

interface PayPalButtonConfig {
    onClick: (data: unknown, actions: PayPalActions) => Promise<void>;
    createOrder: (data: unknown, actions: PayPalActions) => Promise<string>;
    onCancel: () => void;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onError: (err: unknown) => void;
}

interface PayPalNamespace {
    FUNDING: { PAYPAL: string; CARD: string };
    Buttons: (options: Partial<PayPalButtonConfig> & Record<string, unknown>) => { render: (selector: string) => Promise<void> };
}

declare global {
    interface Window {
        paypal?: PayPalNamespace;
    }
}

const SDK_SCRIPT_ID = 'paypal-sdk';
const CAPTURE_ATTEMPTS = 3;
const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

export function showToast(message: string, type: 'error' | 'success' = 'error'): void {
    const toast = document.createElement('div');
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.className = `fixed inset-x-4 bottom-4 z-50 rounded-lg px-5 py-3 text-base font-semibold text-white shadow-lg sm:left-auto sm:right-6 sm:max-w-sm animate-slide-in ${
        type === 'error' ? 'bg-red-800' : 'bg-green-800'
    }`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 6000);
}

export function loadPayPalSdk(url: string): Promise<PayPalNamespace> {
    if (window.paypal) return Promise.resolve(window.paypal);

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.id = SDK_SCRIPT_ID;
        script.src = url;
        script.async = true;
        script.dataset.sdkIntegrationSource = 'astro';
        script.dataset.namespace = 'paypal';
        script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('PayPal SDK sin espacio de nombres')));
        script.onerror = () => {
            script.remove();
            reject(new Error('PayPal SDK no cargado'));
        };
        document.head.appendChild(script);
    });
}

export interface DonationFormOptions {
    buttonId: string;
    inputId: string;
    itemId: string;
    slug: string;
    maxDonation: number;
    feeSchedule: FeeSchedule;
    sdkUrl: string;
}

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const setVisible = (el: HTMLElement | null, visible: boolean) => el?.classList.toggle('hidden', !visible);
const euros = (value: number) => value.toFixed(2).replace('.', ',') + ' €';

export function initDonationForm(options: DonationFormOptions): void {
    const { buttonId, inputId, itemId, slug, maxDonation, feeSchedule, sdkUrl } = options;

    const form = byId(`${buttonId}-form`);
    const thanks = byId(`${buttonId}-thanks`);
    const amountInput = byId<HTMLInputElement>(inputId);
    const paypalContainer = byId(`${buttonId}-paypal`);
    const cardContainer = byId(`${buttonId}-card`);
    const buttonsContainer = byId(`${buttonId}-buttons-container`);
    const helpText = byId(`${inputId}-help`);
    const errorText = byId(`${inputId}-error`);
    const coverFeesCheckbox = byId<HTMLInputElement>(`${inputId}-cover-fees`);
    const feesLabelExtra = byId(`${inputId}-fees-label-extra`);
    const feesSummary = byId(`${inputId}-fees-summary`);
    const loadingIndicator = byId(`${buttonId}-loading`);
    const sdkError = byId(`${buttonId}-sdk-error`);

    if (!form || !amountInput || !paypalContainer || !cardContainer || !buttonsContainer || !helpText || !errorText || !coverFeesCheckbox || !feesLabelExtra || !feesSummary) {
        console.error('Elementos del formulario de donación no encontrados');
        return;
    }

    const parsedAmount = () => parseFloat(amountInput.value) || 0;
    const isValidAmount = (value: number) => value >= 1 && value <= maxDonation;

    function updateFeeUI() {
        const value = parsedAmount();
        if (!coverFeesCheckbox!.checked || !isValidAmount(value)) {
            feesLabelExtra!.textContent = '';
            feesSummary!.textContent = '';
            setVisible(feesSummary, false);
            return;
        }

        const paypalTotal = amountWithFees(value, 'paypal', feeSchedule);
        const cardTotal = amountWithFees(value, 'card', feeSchedule);
        feesLabelExtra!.textContent = ` (+${euros(paypalTotal - value)} con PayPal o +${euros(cardTotal - value)} con tarjeta)`;
        feesSummary!.textContent = `Donación: ${euros(value)}. Total a pagar: ${euros(paypalTotal)} con PayPal o ${euros(cardTotal)} con tarjeta.`;
        setVisible(feesSummary, true);
    }

    function validateAmount() {
        const tooMuch = parsedAmount() > maxDonation;
        amountInput!.classList.toggle('border-red-500', tooMuch);
        amountInput!.classList.toggle('ring-2', tooMuch);
        amountInput!.classList.toggle('ring-red-200', tooMuch);
        amountInput!.classList.toggle('border-line-strong', !tooMuch);
        setVisible(helpText, !tooMuch);
        setVisible(errorText, tooMuch);
        for (const container of [paypalContainer!, cardContainer!]) {
            container.style.opacity = tooMuch ? '0.5' : '1';
            container.style.pointerEvents = tooMuch ? 'none' : 'auto';
        }
        updateFeeUI();
    }

    const presetButtons = Array.from(form.querySelectorAll<HTMLButtonElement>('[data-amount]'));
    amountInput.addEventListener('input', validateAmount);
    amountInput.addEventListener('change', validateAmount);
    amountInput.addEventListener('input', () => {
        presetButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.amount === amountInput.value)));
    });
    presetButtons.forEach((button) => {
        button.addEventListener('click', () => {
            amountInput.value = button.dataset.amount ?? '';
            amountInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });
    coverFeesCheckbox.addEventListener('change', updateFeeUI);

    setVisible(loadingIndicator, true);
    loadPayPalSdk(sdkUrl)
        .then((paypal) => {
            setVisible(loadingIndicator, false);
            renderButtons(paypal);
        })
        .catch((error) => {
            console.error(error);
            setVisible(loadingIndicator, false);
            setVisible(buttonsContainer, false);
            setVisible(sdkError, true);
        });

    function renderButtons(paypal: PayPalNamespace) {
        let isProcessing = false;

        const setBusy = (busy: boolean) => {
            setVisible(loadingIndicator, busy);
            buttonsContainer!.style.opacity = busy ? '0.5' : '1';
            buttonsContainer!.style.pointerEvents = busy ? 'none' : 'auto';
        };
        const stopProcessing = () => {
            setBusy(false);
            isProcessing = false;
        };

        const onClick: PayPalButtonConfig['onClick'] = (_data, actions) => {
            if (isProcessing) return actions.reject();

            if (!isValidAmount(parseFloat(amountInput!.value))) {
                showToast('Por favor, introduce una cantidad válida');
                return actions.reject();
            }

            isProcessing = true;
            setBusy(true);
            setTimeout(() => {
                if (isProcessing) setBusy(false);
            }, 1500);

            return actions.resolve();
        };

        const createOrder = async (source: PaymentSource): Promise<string> => {
            const value = Math.max(1, Math.floor(Number(amountInput!.value) || 0));
            if (value > maxDonation) {
                showToast(`La cantidad máxima que puedes donar es ${maxDonation}€`);
                return Promise.reject();
            }

            try {
                const response = await fetch(`/api/${slug}/paypal/create-order`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ itemId, amount: value, coverFees: coverFeesCheckbox!.checked, paymentSource: source }),
                });
                const orderData = await response.json();

                if (!response.ok) {
                    const message = orderData.error || 'Error al crear la orden';
                    showToast(message);
                    return Promise.reject(message);
                }
                return orderData.id;
            } catch (error) {
                console.error('Error creating order:', error);
                showToast('Error de conexión al crear la orden');
                return Promise.reject(error);
            }
        };

        const showThanks = () => {
            if (!thanks) {
                showToast('¡Pago completado con éxito! Gracias por tu contribución.', 'success');
                setTimeout(() => window.location.reload(), 2000);
                return;
            }
            form!.classList.add('hidden');
            thanks.classList.remove('hidden');
            document.dispatchEvent(new CustomEvent('donation:completed'));
            thanks.querySelector('[data-reload]')?.addEventListener('click', () => window.location.reload());
            thanks.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };

        const failCapture = (message: string) => {
            stopProcessing();
            showToast(message);
        };

        const onApprove: PayPalButtonConfig['onApprove'] = async (data) => {
            for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt++) {
                const last = attempt === CAPTURE_ATTEMPTS;
                try {
                    const response = await fetch(`/api/${slug}/paypal/capture-order`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ orderID: data.orderID }),
                    });
                    const json = await response.json();

                    if (response.ok) return showThanks();
                    if (response.status < 500 || last) return failCapture(json.error || 'Error al procesar el pago');
                } catch {
                    if (last) return failCapture('Error de red al capturar el pago');
                }
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
        };

        const common = {
            onCancel: stopProcessing,
            onApprove,
            onError: (err: unknown) => {
                console.error('PayPal Buttons error', err);
                stopProcessing();
                showToast('Error al procesar con PayPal');
            },
        };
        const style = (label: string) => ({ layout: 'horizontal', color: 'black', shape: 'rect', label, height: 48 });

        paypal
            .Buttons({ ...common, onClick, createOrder: () => createOrder('paypal'), style: style('paypal'), fundingSource: paypal.FUNDING.PAYPAL })
            .render(`#${buttonId}-paypal`);

        paypal
            .Buttons({
                ...common,
                createOrder: () => createOrder('card'),
                style: style('pay'),
                fundingSource: paypal.FUNDING.CARD,
                onClick: (data: unknown, actions: PayPalActions) => {
                    const result = onClick(data, actions);
                    if (MOBILE_UA.test(navigator.userAgent) || window.innerWidth < 1024) {
                        cardContainer!.dataset.expanded = '';
                    }
                    return result;
                },
            })
            .render(`#${buttonId}-card`);
    }
}
