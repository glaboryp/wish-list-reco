import type { AstroGlobal } from 'astro';
import type { Center } from '../../types/database';
import { centerNotFoundPage, forbiddenPage } from '../error-pages';
import { authorizeCenter, authorizeSuperadmin, getActor, type Actor } from './access';

type GuardContext = Pick<AstroGlobal, 'cookies' | 'params' | 'redirect'>;

function deny(astro: GuardContext, status: 401 | 403 | 404): Response {
  if (status === 401) return astro.redirect('/login');
  if (status === 403) return forbiddenPage();
  return centerNotFoundPage();
}

export async function guardCenter(astro: GuardContext): Promise<{ actor: Actor; center: Center } | Response> {
  const result = await authorizeCenter(await getActor(astro.cookies), astro.params.slug ?? '');
  return result.ok ? { actor: result.actor, center: result.center } : deny(astro, result.status);
}

export async function guardSuperadmin(astro: GuardContext): Promise<{ actor: Actor } | Response> {
  const result = authorizeSuperadmin(await getActor(astro.cookies));
  return result.ok ? { actor: result.actor } : deny(astro, result.status);
}
