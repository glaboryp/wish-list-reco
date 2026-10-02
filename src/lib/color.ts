const HEX_PATTERN = /^#[0-9a-f]{6}$/i;
const MIN_CONTRAST_WITH_WHITE = 4.5;

export function isHexColor(value: string): boolean {
  return HEX_PATTERN.test(value);
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

export function isValidPrimaryColor(value: string): boolean {
  return isHexColor(value) && contrastRatio(value, '#ffffff') >= MIN_CONTRAST_WITH_WHITE;
}

export function darken(hex: string, amount: number): string {
  const [r, g, b] = channels(hex).map((c) => Math.round(c * (1 - amount)));
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}
