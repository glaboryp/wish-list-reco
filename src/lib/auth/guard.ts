import type { AstroGlobal } from 'astro';
import type { Center } from '../../types/database';
import { authorizeCenter, authorizeSuperadmin, getActor, type Actor } from './access';

type GuardContext = Pick<AstroGlobal, 'cookies' | 'params' | 'redirect'>;

const FORBIDDEN_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sin acceso</title>
<style>
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:1rem;box-sizing:border-box;background:#f7f7f5;color:#1f2937;font:1.125rem/1.6 system-ui,sans-serif}
main{max-width:32rem}
h1{font-size:1.75rem;margin:0 0 .75rem}
p{margin:0 0 1rem}
.links{display:flex;flex-wrap:wrap;gap:.75rem}
a{display:inline-flex;align-items:center;min-height:2.75rem;padding:0 1.25rem;border-radius:.5rem;border:1px solid #6b7280;color:#1f2937;font-weight:600;text-decoration:none}
a:hover{background:#fff}
</style>
</head>
<body>
<main>
<h1>No tienes acceso a esta página</h1>
<p>Tu cuenta no es encargada de este centro, o has dejado de serlo. Si crees que es un error, pide a otra encargada que te vuelva a dar acceso.</p>
<div class="links"><a href="/">Volver a la portada</a><a href="/login">Entrar con otra cuenta</a></div>
</main>
</body>
</html>`;

function forbiddenPage(): Response {
  return new Response(FORBIDDEN_HTML, { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function deny(astro: GuardContext, status: 401 | 403 | 404): Response {
  if (status === 401) return astro.redirect('/login');
  if (status === 403) return forbiddenPage();
  return new Response('Centro no encontrado', { status: 404 });
}

export async function guardCenter(astro: GuardContext): Promise<{ actor: Actor; center: Center } | Response> {
  const result = await authorizeCenter(await getActor(astro.cookies), astro.params.slug ?? '');
  return result.ok ? { actor: result.actor, center: result.center } : deny(astro, result.status);
}

export async function guardSuperadmin(astro: GuardContext): Promise<{ actor: Actor } | Response> {
  const result = authorizeSuperadmin(await getActor(astro.cookies));
  return result.ok ? { actor: result.actor } : deny(astro, result.status);
}
