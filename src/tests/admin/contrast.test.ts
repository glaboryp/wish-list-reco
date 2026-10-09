import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
const token = (name: string): string => {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Missing token ${name}`);
  return match[1];
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('WCAG AA contrast', () => {
  it.each(['ok', 'info', 'warn', 'muted'])('the %s status chip has at least 4.5:1', (tone) => {
    expect(contrast(token(`chip-${tone}-bg`), token(`chip-${tone}-fg`))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['muted text on white', 'muted', '#ffffff'],
    ['muted text on the page background', 'muted', '#f7f8fa'],
    ['brand on white', 'brand', '#ffffff'],
    ['brand on the soft background', 'brand', '#e9eefb'],
  ])('%s has at least 4.5:1', (_label, fg, bg) => {
    const background = bg.startsWith('#') ? bg : token(bg);
    expect(contrast(token(fg), background)).toBeGreaterThanOrEqual(4.5);
  });
});
