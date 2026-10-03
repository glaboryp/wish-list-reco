# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Donantes**: familias, antiguos alumnos y público general que llegan a la página de un centro (casi siempre desde el móvil), eligen un artículo de su lista de deseos y donan con PayPal. No conocen la plataforma y no deben necesitar explicación.
- **Encargadas de centro**: personal no técnico de cada centro (siempre mujeres, usar el femenino). Gestionan su propia web (portada, artículos, donaciones manuales, otras encargadas) desde móvil o PC, de forma ocasional. No saben qué es un "alt text" o un "slug".
- **Administradora de la plataforma** (superadmin): una persona técnica que da de alta centros, configura PayPal y gestiona accesos.

## Product Purpose

Cada centro social o educativo (el primero es Recoletos) publica su propia lista de deseos con lo que necesita y recibe donaciones por artículo. La plataforma es multicentro: `/` lista los centros, `/{slug}` es la web de cada centro, `/{slug}/admin` su panel y `/admin` el panel de la administradora. Éxito: un donante completa una donación sin dudas y una encargada mantiene su web sin ayuda.

## Positioning

Donación directa a necesidades concretas y visibles de un centro concreto, con la identidad de cada centro (color, logo, portada), no un buzón genérico de ONG.

## Operating Context

- Las encargadas entran con su cuenta de Google (Firebase Auth); el acceso lo da la administradora por correo.
- Pagos con PayPal por centro, con credenciales propias (sandbox o live). Las donaciones también pueden registrarse a mano (efectivo, transferencia).
- Desplegado en Vercel con Astro y Neon (Postgres). Contenido en español.
- El dominio antiguo redirige de forma permanente a la web del centro Recoletos.

## Capabilities and Constraints

- Cada centro elige su color principal, que debe tener contraste suficiente con texto blanco (se valida al guardar).
- Las imágenes se suben a Vercel Blob (webp, jpg o png, máximo 5 MB).
- Los artículos pueden estar visibles, ocultos (borrador) o archivados; si tienen donaciones no se borran.
- Un solo centro existe hoy. Debe funcionar igual con uno, varios o ninguno.
- Todo texto de la interfaz está en español y debe poder entenderlo cualquier persona no técnica.
- Modo oscuro: fuera de alcance por ahora.

## Brand Commitments

- La plataforma tiene su propio color y no usa el de ningún centro; cada centro usa el suyo solo en su web pública.
- Tono cercano y claro, sin jerga técnica ni anglicismos innecesarios.

## Evidence on Hand

- Un centro real (Recoletos) con logo, portada y artículos. No hay testimonios, cifras ni logos de terceros; no inventarlos.
- Contacto de soporte para encargadas: glabory@gmail.com.

## Product Principles

1. Lo entiende cualquier persona no técnica sin leer instrucciones: cada campo dice qué es y dónde se ve.
2. Donar o gestionar es la acción principal de cada pantalla; todo lo demás es secundario y se distingue a simple vista.
3. Cada centro se reconoce en su web; la plataforma se mantiene neutra y sobria.
4. Móvil y escritorio por igual, también para quien administra.
5. Confianza ante todo: nada que parezca engañoso o ambiguo con el dinero.

## Accessibility & Inclusion

Contraste AA como mínimo, objetivos táctiles amplios, foco visible, respeto de `prefers-reduced-motion` y textos legibles para cualquier edad.
