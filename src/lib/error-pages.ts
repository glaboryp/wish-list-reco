export interface PageLink {
    href: string;
    label: string;
}

interface MessagePage {
    status: number;
    title: string;
    heading: string;
    message: string;
    links: PageLink[];
}

const escapeHtml = (value: string) =>
    value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function messagePage({ status, title, heading, message, links }: MessagePage): Response {
    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
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
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(message)}</p>
<div class="links">${links.map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join('')}</div>
</main>
</body>
</html>`;
    return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export const centerNotFoundPage = () =>
    messagePage({
        status: 404,
        title: 'Centro no encontrado',
        heading: 'No encontramos este centro',
        message: 'La dirección no corresponde a ningún centro activo. Puede que esté mal escrita o que el centro ya no esté disponible.',
        links: [{ href: '/', label: 'Ver los centros' }],
    });

export const itemNotFoundPage = (center: { slug: string; name: string }) =>
    messagePage({
        status: 404,
        title: 'Artículo no encontrado',
        heading: 'No encontramos este artículo',
        message: 'Puede que la dirección esté mal escrita o que el artículo ya no esté en la lista.',
        links: [{ href: `/${center.slug}#wishlist`, label: `Ver la lista de ${center.name}` }],
    });

export const forbiddenPage = () =>
    messagePage({
        status: 403,
        title: 'Sin acceso',
        heading: 'No tienes acceso a esta página',
        message: 'Tu cuenta no es encargada de este centro, o has dejado de serlo. Si crees que es un error, pide a otra encargada que te vuelva a dar acceso.',
        links: [
            { href: '/', label: 'Volver a la portada' },
            { href: '/login', label: 'Entrar con otra cuenta' },
        ],
    });
