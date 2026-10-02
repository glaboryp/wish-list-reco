import { describe, expect, it } from 'vitest';
import { legacyRedirectTarget } from '../../lib/legacy-redirect';

const target = (url: string) => legacyRedirectTarget(new URL(url));

describe('legacyRedirectTarget', () => {
  it('sends the root of the legacy domain to the Recoletos center', () => {
    expect(target('https://wish-list-reco.vercel.app/')).toBe('https://wish-list-oratorio.vercel.app/recoletos');
  });

  it('keeps the query string on the root redirect', () => {
    expect(target('https://wish-list-reco.vercel.app/?utm_source=qr')).toBe(
      'https://wish-list-oratorio.vercel.app/recoletos?utm_source=qr',
    );
  });

  it('keeps any other path and query unchanged', () => {
    expect(target('https://wish-list-reco.vercel.app/item/378da98b-2aef-4f67-99aa-012ce54d35d7?x=1')).toBe(
      'https://wish-list-oratorio.vercel.app/item/378da98b-2aef-4f67-99aa-012ce54d35d7?x=1',
    );
    expect(target('https://wish-list-reco.vercel.app/recoletos')).toBe('https://wish-list-oratorio.vercel.app/recoletos');
  });

  it('does not touch the canonical domain, previews or localhost', () => {
    expect(target('https://wish-list-oratorio.vercel.app/')).toBeNull();
    expect(target('https://wish-list-reco-git-feat-x-glorias-projects.vercel.app/')).toBeNull();
    expect(target('http://localhost:4321/')).toBeNull();
  });

  it('does not match look-alike hosts', () => {
    expect(target('https://wish-list-reco.vercel.app.evil.example/')).toBeNull();
    expect(target('https://evil-wish-list-reco.vercel.app/')).toBeNull();
  });

  it('treats the host case-insensitively', () => {
    expect(target('https://WISH-LIST-RECO.vercel.app/')).toBe('https://wish-list-oratorio.vercel.app/recoletos');
  });
});
