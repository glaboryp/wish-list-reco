---
name: Listas de deseos
description: Plataforma sobria y clara para que cada centro publique su lista de deseos y reciba donaciones.
colors:
  brand: "#2b4ba8"
  brand-hover: "#223c87"
  brand-soft: "#e9eefb"
  ink: "#1b2433"
  muted: "#566074"
  line: "#e3e6ec"
  line-strong: "#8993a4"
  surface: "#f7f8fa"
  center-primary: "#007986"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Atkinson Hyperlegible Next Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
  body:
    fontFamily: "Atkinson Hyperlegible Next Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Atkinson Hyperlegible Next Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
rounded:
  control: "8px"
  card: "12px"
  chip: "9999px"
spacing:
  field: "20px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
  button-secondary:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
  button-danger:
    backgroundColor: "#ffffff"
    textColor: "#991b1b"
    rounded: "{rounded.control}"
    height: "44px"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
  card:
    backgroundColor: "#ffffff"
    rounded: "{rounded.card}"
    padding: "24px"
---

# Design System: Listas de deseos

## Overview

Sobrio, claro y de confianza. Lo importante es que cualquier persona no técnica entienda cada pantalla y sepa qué botón pulsar. La plataforma usa tinta oscura y un único acento azul; cada centro lleva su propio color solo en su web pública. Una sola familia tipográfica, de gran legibilidad.

## Colors

- **Acento de la plataforma** (`brand`): botones primarios, enlaces, pestaña activa y foco. Nunca se usa el color de un centro en inicio, login o panel.
- **Tinta y gris** (`ink`, `muted`): texto y ayudas. `muted` cumple contraste AA sobre blanco.
- **Líneas** (`line` para separadores, `line-strong` para bordes de controles, que superan 3:1).
- **Color de centro** (`center-primary`): variable `--primary` en la web pública de cada centro, elegida por la encargada y validada para contraste con texto blanco. En el panel solo aparece en la vista previa.

## Typography

Atkinson Hyperlegible Next, autoalojada. Jerarquía por tamaño y peso, sin segunda familia. Texto base de 16px, etiquetas en 600, importes con cifras tabulares (`.tabular`). Los títulos de página usan 2xl a 3xl en el panel y 4xl a 5xl en el inicio.

## Layout

Contenedor de 64rem en panel e inicio, 28rem en login. Formularios en una columna, con tres campos por fila solo cuando son cortos. Pie de formulario separado por una línea y con la acción principal sola. Las tablas pasan a lista apilada con etiquetas en móvil (`.stack-table` con `data-label`).

## Elevation & Depth

Sombras suaves tintadas de tinta (`shadow-card`) y, solo al pasar el cursor por tarjetas enlazables, `shadow-lift` teñida del acento.

## Shapes

Una sola escala: 8px en controles, 12px en tarjetas, píldora solo en chips de estado.

## Components

- **Botones**: primario sólido, secundario con borde, peligro con borde rojo. Todos de 44px de alto mínimo, con icono opcional y estado de desactivado.
- **Chips de estado**: verde (correcto), azul suave (informativo), ámbar (pendiente), gris (inactivo). Siempre con texto.
- **Subida de imagen**: botón secundario con icono, vista previa y mensajes de estado.
- **Avisos**: caja con icono, `role="status"` o `role="alert"`; el de éxito se cierra solo y con botón.
- **Navegación del panel**: cabecera con el centro y dos botones secundarios (Ver mi web, Salir) y debajo pestañas subrayadas.

## Do's and Don'ts

- Haz que cada campo diga qué es y dónde se ve; añade ayuda bajo el campo.
- Haz que las acciones de destino distinto se distingan por estilo (primario, secundario, peligro), no solo por el texto.
- No uses el color de un centro fuera de su web.
- No uses jerga técnica ni em-dashes en los textos.
- No añadas etiquetas de sección en mayúsculas sobre los títulos.
