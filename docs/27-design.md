---
title: Diseño
---

# Diseño

Una pastelería de barrio con ganas: cálida, tipográfica y con dibujos propios. No hay fotos porque el negocio es ficticio, y unas fotos de banco de imágenes lo habrían dejado claro. En su lugar hay ilustraciones hechas en SVG, que además pesan casi nada.

## Tokens

Todo sale de variables CSS definidas en el `:host` de la página (`sites/pasteleria.scss`).

| Variable         | Valor     | Uso                                     |
| ---------------- | --------- | --------------------------------------- |
| `--bz-bg`        | `#fff6ef` | Fondo: crema                            |
| `--bz-surface`   | `#fffdfb` | Superficies                             |
| `--bz-ink`       | `#3d1f2e` | Texto: un ciruela muy oscuro, no negro  |
| `--bz-muted`     | `#86616f` | Texto secundario                        |
| `--bz-line`      | `#f0d9d3` | Líneas                                  |
| `--bz-accent`    | `#cf3f68` | Frambuesa: acciones y marca             |
| `--bz-accent-ink` | `#fff`   | Texto sobre el acento                   |
| `--bz-radius`    | `22px`    | Esquinas                                |

Las ilustraciones tienen su propia paleta, de `--a1` a `--a5`, con el dorado `#f2b84b` y el rosa `#f6c9cf` como acompañantes.

## Tipografía

| Fuente  | Variable       | Uso                                      |
| ------- | -------------- | ---------------------------------------- |
| Gloock  | `--bz-display` | Titulares, precios y nombres de productos |
| Figtree | `--bz-font`    | Texto, botones y formularios             |

Gloock es una serifa de display con mucho contraste, que da el aire de cartel de obrador. El titular principal escala con `clamp(44px, 6.6vw, 92px)`. Las dos se sirven desde el propio dominio con `@fontsource`, sin llamadas a Google.

## Componentes tintados

El chat, el panel y la carta no saben de qué negocio son. Leen las variables `--bz-*` de la web que los contiene, con valores por defecto:

```scss
:host {
  --c-accent: var(--bz-accent, #1d5fd1);
  --c-bg: var(--bz-chat-bg, var(--bz-surface, #fff));
  --c-font: var(--bz-font, system-ui, sans-serif);
  --c-display: var(--bz-display, var(--c-font));
}
```

Con eso, el chat parece de la pastelería sin una línea de CSS específica. Otra web con otras variables tendría otro chat.

El panel del local es la excepción a propósito: mantiene una estética neutra de herramienta, con la fuente del sistema, y solo toma el color de acento. Así se ve que es otra cara del negocio.

## Disposición

- **Portada** a dos columnas: mensaje e ilustración.
- **Tartas** en una rejilla de tres, con una tarjeta de un color pastel distinto cada una.
- **Plazos** en un bloque oscuro que corta el ritmo de la página. Es lo más importante que hay que saber antes de encargar, y es la sección que más contrasta.
- **Mostrador** en una lista por categorías, más estrecha, para leer.
- **El obrador** con la dirección y el horario.

La página no tiene formulario de encargo: los botones abren el asistente con la tarta ya elegida. La idea es que hablar con él sea la forma natural de encargar, y no una opción aparte.

## El chat

- Flota abajo a la derecha, con un botón que dice *Habla con el asistente*.
- En el móvil ocupa toda la pantalla, por debajo de la barra de demostración.
- Las burbujas del cliente van en color de acento; las del asistente, en un fondo suave; las del local, con borde de color, para que se vea que ha contestado una persona.
- La cabecera siempre dice lo que es: *Soy un asistente; una persona confirmará*.
- Una franja de estado cuenta en qué punto está el pedido, con un punto que late mientras se espera.
- Las pruebas no estorban: *Cómo lo ha comprobado* está plegado.

## Colores de estado

| Estado    | Color                   | Se usa en                       |
| --------- | ----------------------- | ------------------------------- |
| Esperando | Ámbar `#9a6200`         | Pendiente de confirmar          |
| Bien      | Verde `#1b7a43`         | Confirmado                      |
| Mal       | Rojo `#b3302b`          | Rechazado                       |
| Aviso     | Azul `#1d5fd1`          | Cambio propuesto, informativo   |

## Puntos de corte

| Ancho       | Cambia                                                         |
| ----------- | -------------------------------------------------------------- |
| 1100 px     | Con el panel abierto, la web se aparta en vez de quedar debajo |
| 960 px      | Portada y visita a una columna; dos tartas por fila            |
| 720 px      | La barra de demostración se acorta                             |
| 640 px      | El chat ocupa toda la pantalla                                 |
| 560 px      | Una tarta por fila                                             |

Probado a 390 px de ancho sin desplazamiento horizontal.

## Accesibilidad

- Estructura de encabezados y `aria-labelledby` en cada sección.
- El chat es un `role="log"` con `aria-live="polite"`.
- Foco visible en todo lo interactivo, y Escape cierra el chat y el panel.
- Las tarjetas son grupos con su etiqueta, y los botones de cantidad dicen qué hacen.
- Con `prefers-reduced-motion`, se quitan las animaciones.
- `<html lang="es">`, aunque el asistente pueda hablar en gallego.

## Lo que no hay

Sin degradados en los fondos, sin emojis, sin carruseles, sin banners de cookies (no hay cookies) y sin imágenes de stock.
