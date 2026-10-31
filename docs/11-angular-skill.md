---
title: Angular
---

# Angular

La web está en **Angular 22.2 y TypeScript 6.0**, sin Zone.js y sin librería de componentes. Son 16 ficheros de TypeScript, y todo el estado va en signals.

## Qué usa de Angular

| API                                         | Dónde                        | Para                                                              |
| ------------------------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| Zoneless (`provideZonelessChangeDetection`) | `app.config.ts`              | Sin `zone.js`: los signals avisan a la vista                      |
| Componentes standalone                      | Todos                        | Cada componente importa lo que usa                                |
| `signal`, `computed`                        | `BizChat`, `BizStaff`, `BizUi` | Estado local y derivado                                         |
| `effect`, `untracked`                       | `BizChat`, `BizStaff`        | Reaccionar a abrir el chat o a una petición, sin crear dependencias de más |
| `input.required`, `input`                   | `BizChat`, `BizMenu`, `BizArt` | Entradas como signals                                           |
| `viewChild`                                 | `BizChat`                    | El campo de texto y el historial, sin decoradores                 |
| `inject()`                                  | Todos                        | Inyección sin constructor                                         |
| `@if`, `@for`, `@switch`, `@empty`          | Todas las plantillas         | Control de flujo nativo                                           |
| `loadComponent`                             | `app.routes.ts`              | La página va en un fragmento aparte                               |
| `withInMemoryScrolling`                     | `app.config.ts`              | Los enlaces a `#tartas` o `#plazos` funcionan con el router       |
| `host`                                      | `BizFrame`, `BizChat`, `BizStaff` | Clases y atajos de teclado en el propio componente           |
| `NgTemplateOutlet`                          | `BizChat`, `BizStaff`        | Reutilizar la tarjeta de una solicitud                            |
| `DomSanitizer`                              | `BizArt`                     | Pintar los SVG propios, que son constantes del código             |

## Estado

No hay librería de estado. Hay tres niveles:

- **Del componente:** `BizChat` guarda sus mensajes, si está ocupado y el borrador en signals propios.
- **Compartido:** `BizUi` es un servicio con cuatro signals: si el chat y el panel están abiertos, cuántos pendientes hay y la última petición al asistente.
- **Del servidor:** el motor es la fuente de verdad. La web no calcula totales ni disponibilidad, solo enseña lo que recibe.

Una parte de la web le pide cosas al asistente sin conocerlo, a través de `BizUi`:

```ts
// En la página: «Encargar» en una tarta.
this.ui.ask({ action: { type: 'add', item_id: i.id }, label: `Encargar: ${i.name}` });

// En el chat: atiende cada petición una sola vez, gracias al `nonce`.
effect(() => {
  const req = this.ui.request();
  if (!req || req.nonce === this.lastAsk) return;
  this.lastAsk = req.nonce;
  untracked(() => void this.handleAsk(req));
});
```

## Componentes

| Componente       | Selector        | Responsabilidad                                                   |
| ---------------- | --------------- | ----------------------------------------------------------------- |
| `Shell`          | `app-root`      | Solo el `router-outlet`                                           |
| `PasteleriaSite` | `site-pasteleria` | La página: copy, diseño y secciones                             |
| `BizFrame`       | `biz-frame`     | Barra de demostración; aloja el chat y el panel                   |
| `BizChat`        | `biz-chat`      | Conversación, tarjetas, botones, reintentos y seguimiento         |
| `BizStaff`       | `biz-staff`     | Solicitudes, agenda y las decisiones del local                    |
| `BizMenu`        | `biz-menu`      | Carta por categorías, con precios y alérgenos                     |
| `BizArt`         | `biz-art`       | Ilustraciones por nombre                                          |
| `Icon`           | `app-icon`      | Iconos de trazo por nombre                                        |

`SiteBase` es la clase de la que hereda cada web: carga el perfil del negocio y da los atajos `ask` y `start`. Una web nueva solo tiene que decir su `slug` y pintar sus secciones.

## El chat por dentro

- **Respuesta optimista:** el mensaje se pinta al enviarlo con un id temporal y se sustituye por el real al recibir la respuesta. Si falla, se quita y aparece *Reintentar*.
- **Enter sin carreras:** al enviar se lee el valor del campo y no el signal, para que valga aunque se pulse Enter justo al teclear.
- **Espera larga:** tras 5 segundos aparece «Un momento, lo estoy comprobando…».
- **Seguimiento:** mientras la solicitud está pendiente, consulta cada 2,5 segundos y añade los mensajes del local. Si el chat está cerrado, suma al contador del botón.
- **Recuperar:** al recargar, pide la conversación con el expediente guardado.
- **Accesibilidad:** `role="log"` con `aria-live`, foco al abrir, Escape para cerrar y soporte de `prefers-reduced-motion`.

## HTTP

`BizApi` es el único que llama al servidor. Convierte cada `Observable` en una promesa con `firstValueFrom` y le pone un límite de tiempo:

```ts
chat(slug: string, body: { text?: string; action?: ChatAction; label?: string }): Promise<ChatResponse> {
  return firstValueFrom(
    this.http.post<ChatResponse>(`/api/${slug}/chat`, {
      session: this.session, case_id: this.caseId(slug) ?? undefined, ...body,
    }).pipe(timeout(60000)),
  );
}
```

Los contratos con el motor están en `biz-types.ts`. En desarrollo, `proxy.conf.json` lleva `/api` al motor; en producción lo hace `serve.mjs`.

## Build

| Fichero             | Tamaño   | Transferido |
| ------------------- | -------- | ----------- |
| Inicial             | 268 kB   | 76 kB       |
| Página de la pastelería | 97 kB | 22 kB      |

El presupuesto de `angular.json` avisa a los 500 kB y falla a 1 MB. El CSS crítico en línea está desactivado porque trae un script que la política de seguridad no permite. Ver [Decisiones](./09-decisions.md).

Las tipografías se sirven desde el propio dominio con `@fontsource`, sin llamadas a terceros.
