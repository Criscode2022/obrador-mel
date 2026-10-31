---
title: Una persona confirma
---

# Una persona confirma

> Soy un asistente; una persona lo confirmará.

Lo que distingue a este asistente es lo que no puede hacer. Puede recoger un encargo, comprobarlo y dejarlo listo, pero no confirmarlo. Y esto no depende de que el modelo se porte bien: no existe un camino en el código que lo permita.

## Dónde está el límite

| Lado            | Función          | Estados que puede dejar                                     |
| --------------- | ---------------- | ----------------------------------------------------------- |
| Cliente         | `chatTurn()`     | `collecting`, `pending`, `answered`                         |
| Persona del local | `staffAct()`   | `confirmed`, `denied`, `change_proposed`, `answered`, `reviewed` |

`finishConfirmed`, lo único que deja un pedido confirmado, exige una aprobación:

```js
export async function finishConfirmed({ kase, request, business, approvalId, lang, note, now = new Date() }) {
  if (!approvalId) throw new Error('confirmar exige una aprobación (approval_id)');
  // ...
}
```

La aprobación es una fila de `approvals` escrita antes, con su autor y su decisión.

Hay una sola excepción aparente: `change_accept`, que el cliente pulsa en el chat. Pero solo funciona si una persona ya propuso esa hora, y usa la aprobación que se guardó entonces.

## El ciclo de un pedido

```
                      el cliente pulsa «Enviar pedido»
collecting ──────────────────────────────────────────► pending
                                                        │
              ┌─────────────────┬───────────────────────┤
              │ Confirmar       │ Otra hora             │ Rechazar
              ▼                 ▼                       ▼
          confirmed       change_proposed            denied
              ▲              │         │
              │ acepta       │         │ no le viene bien
              └──────────────┘         ▼
                                    pending
```

### Confirmar

`staffAct({ action: 'accept' })`:

1. Escribe la aprobación en `approvals` y el evento `approval`.
2. En una reserva, crea el evento de calendario con ese `approval_id`. Un pedido no lo necesita.
3. Escribe el markdown de cierre y pasa el expediente a `emit`.
4. Marca la solicitud como `confirmed`.
5. Deja el mensaje para el cliente, con la tarjeta en verde.

El cliente lo ve en el chat en menos de 2,5 segundos, porque está consultando novedades.

```
Pedido confirmado: estará listo el sábado 7 de noviembre a las 11:00.
Total 30,00 €; se paga al recoger.
```

Si la persona escribe una nota, va al final del mensaje.

### Otra hora

El panel enseña los días con hueco y las horas libres de cada uno. La hora se comprueba otra vez en el motor al proponerla: si no está libre, un 409.

```
El local no llega a la hora pedida. Propone dejártelo listo el sábado 7 de noviembre
a las 11:30. ¿Te viene bien?
```

El mensaje lleva dos botones. Si acepta, el pedido se confirma con la hora nueva y la tarjeta se actualiza. Si no, vuelve a `pending` y el local lo ve otra vez.

### Rechazar

Con un motivo opcional, que le llega al cliente. El expediente pasa a `refused` y no se emite nada.

## Lo que no es un pedido

| Solicitud  | Cuándo                                    | Qué hace la persona                     |
| ---------- | ----------------------------------------- | --------------------------------------- |
| `question` | El asistente no sabe responder            | Escribe la respuesta, que cierra el expediente |
| `handoff`  | Pide una persona, o es una boda o una queja | Igual                                 |
| `info`     | El asistente ya contestó                  | La marca como revisada                  |

Las respuestas informativas se dan al momento, con sus fuentes, y quedan abiertas para que el local las repase. Una respuesta sobre el horario no necesita esperar a nadie, pero alguien debería poder ver qué se ha dicho en nombre del negocio.

Mientras una persona atiende una solicitud, el asistente no se mete: el mensaje se guarda, se le avisa al cliente y no se contesta nada automático.

## Lo que ve la persona

Cada solicitud del panel enseña lo necesario para decidir sin abrir nada más:

- Qué pidió el cliente, con sus palabras.
- Las líneas, el total, el nombre, el teléfono y las notas.
- *Lo que comprobó el asistente*: huecos, plazos, alérgenos y fuentes.

Eso viene de `tool_calls` y `citations`. El objetivo es que confirmar sea un clic informado, y no volver a hacer el trabajo del asistente.

## El cierre

Cada expediente cerrado por una persona deja un markdown en `output/`, y su texto en `artifacts`. Es la huella de lo que se aprobó.

```markdown
# Expediente EXP-20261031-e49ad6

- id: EXP-20261031-e49ad6
- lang: es
- route: local
- tokens: in=0 out=0
- negocio: Obrador Mel (pasteleria)
- solicitud: order · confirmed
- aprobación: apr-3ae610314f19ae9d (local (demostración))

## Detalle

- 2 × Palmera de hojaldre: 4,40 €
- total: 4,40 €
- recogida: 2026-11-07 11:30
- a nombre de: Iria

## Citations

- (ningunha)

## Ferramentas

- 1. pickup (motor)
- 2. pickup (motor)
- 3. pickup (motor)

Son un asistente; unha persoa confirmou. Demostración con un negocio ficticio: non hai datos reais.
```

Los `.md` de `output/` pueden llevar datos de quien prueba la demo, así que están en `.gitignore`.

## Lo que queda registrado

| Pregunta                         | Dónde                                   |
| -------------------------------- | --------------------------------------- |
| ¿Quién lo aprobó y cuándo?       | `approvals`                             |
| ¿Qué pasó y en qué orden?        | `events`, que no se puede modificar     |
| ¿Por qué dijo eso el asistente?  | `router_decisions`, `citations`, `tool_calls` |
| ¿Qué le dijo al cliente?         | `messages`                              |
| ¿Qué se aprobó exactamente?      | `artifacts`                             |
