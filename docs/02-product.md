---
title: Producto y features
---

# Producto y features

## El problema

Una pastelería pequeña recibe siempre las mismas preguntas: a qué hora abrís, qué lleva, cuánto cuesta para doce, con cuánta antelación hay que encargar. Cada encargo por teléfono son cinco minutos de alguien con las manos en la masa, y un dato mal apuntado es una tarta que no sale.

Un chatbot normal resuelve la mitad y crea otro problema: si inventa un precio o acepta una tarta para mañana que no se puede hacer, el que queda mal es el negocio.

Obrador Mel plantea otro reparto: el asistente hace todo el trabajo de recoger y comprobar, y una persona sigue siendo quien se compromete con el cliente.

## Para quién

| Persona                 | Qué hace                                                                  |
| ----------------------- | ------------------------------------------------------------------------- |
| Cliente                 | Pregunta y encarga desde la web, a cualquier hora, en castellano o gallego |
| Persona del obrador     | Revisa lo que deja preparado el asistente y confirma, cambia o rechaza     |

## La web

Una sola página con las secciones de una pastelería de verdad:

- **Portada** con el mensaje principal y la ilustración de la tarta.
- **Tartas por encargo:** seis tarjetas con precio y plazo. El botón *Encargar* abre el asistente con esa tarta ya en el pedido.
- **Cuándo puedes recogerla:** los plazos de un vistazo (24 horas, 48 horas, 5 días, 3 semanas) y preguntas sugeridas que se envían al asistente con un clic.
- **Del día en el mostrador:** pastelería, panadería y regalos, con alérgenos y un botón para añadir al pedido.
- **El obrador:** dirección, teléfono, correo y horario semanal.

El precio, los alérgenos, el horario y los plazos no están escritos en el HTML: salen del mismo perfil que usa el motor, así que la web y el asistente no pueden contradecirse.

## El asistente

### Información

| Pregunta                                  | Cómo se contesta                                                     |
| ----------------------------------------- | -------------------------------------------------------------------- |
| «¿A qué hora abrís?», «¿el lunes abrís?»  | Calculado con el horario y los cierres, teniendo en cuenta qué día es |
| «¿Cuánto cuesta el brownie?»              | Del catálogo                                                         |
| «¿Qué tenéis sin gluten?»                 | Filtrado del catálogo por alérgenos, con la lista de productos        |
| «¿La tarta de zanahoria lleva frutos secos?» | Del catálogo, con el aviso de que una persona lo confirma           |
| «¿Dónde estáis?», «¿qué teléfono tenéis?» | De la ficha del negocio                                              |
| «¿Se pueden congelar las tartas?»         | Búsqueda en el conocimiento y respuesta del modelo con sus fuentes    |
| «¿Tenéis wifi?»                           | Si no está en los datos, no se inventa: pasa a una persona            |

Un mensaje con varias preguntas se contesta entero: «¿Cuánto cuesta el brownie y lleva frutos secos?» recibe dos respuestas, en ese orden.

### Encargos

El cliente escribe como le sale y el asistente saca todo lo que pueda de una vez:

> Quiero una tarta de queso para 12 personas para el sábado a las 11

Eso ya trae el producto, las raciones, el día y la hora. El asistente solo pregunta lo que falta (nombre, teléfono, dedicatoria), de uno en uno y con botones cuando tiene sentido.

- **Ambigüedad:** «una tarta» pregunta cuál, con el precio de cada una.
- **Opciones obligatorias:** las tartas necesitan raciones (8, 12 o 20). Sin eso no se sigue.
- **Plazos:** una tarta de queso para mañana no se acepta: explica que necesita 48 horas y enseña los días con hueco.
- **Huecos:** la hora pedida se comprueba contra los huecos libres. Si ya pasó o no queda sitio, ofrece las más cercanas.
- **Cambios:** «quita el brownie», «mejor cinco palmeras», o los botones de más y menos de la tarjeta del pedido.
- **Dudas a mitad:** una pregunta en mitad de un encargo se contesta y el encargo sigue donde estaba.
- **Cancelar:** «cancela» a mitad deja todo sin enviar.

### Lo que no hace

- No confirma nada, ni cobra, ni pide datos de tarjeta. Si alguien escribe una, se tapa y se le dice que no hace falta.
- No inventa: lo que no sabe, lo pasa a una persona.
- No gestiona bodas, eventos, facturas, quejas ni devoluciones: eso va directo a una persona.
- No contesta a lo que no tiene que ver con el obrador, ni cambia sus reglas porque se lo pidan.

## El panel del local

Se abre con el botón *Panel del local*. En una demo real estaría detrás de un acceso; aquí está a la vista para enseñar los dos lados, y cada visitante solo ve lo que ha probado él.

| Pestaña    | Qué tiene                                                                     |
| ---------- | ----------------------------------------------------------------------------- |
| Por atender | Pedidos pendientes, preguntas sin respuesta y respuestas del asistente por revisar |
| Agenda     | Ocupación por hueco de recogida de cada día, separando lo propio de lo de fondo |
| Hecho      | Lo ya cerrado                                                                 |

Sobre un pedido pendiente se puede:

- **Confirmar:** el cliente lo ve en el chat al momento y el expediente se cierra.
- **Otra hora:** se elige un hueco libre y el cliente acepta o rechaza desde el chat.
- **Rechazar:** con un motivo opcional que le llega al cliente.

Una pregunta sin respuesta se contesta desde el panel, y esa respuesta le llega al cliente en la misma conversación. Cada solicitud enseña lo que comprobó el asistente: huecos, plazos, fuentes.

## Reglas del obrador

Viven en `datasets/pasteleria/` y el motor las aplica tal cual.

| Regla                       | Valor                                                                      |
| --------------------------- | -------------------------------------------------------------------------- |
| Horario                     | Martes a sábado, 9:00 a 14:00 y 16:30 a 20:00; domingo, 9:30 a 14:00; lunes cerrado |
| Cierres                     | 25 de diciembre, 1 y 6 de enero                                            |
| Preparación mínima          | 15 minutos para lo que hay en mostrador                                    |
| Plazos de encargo           | Tarta de Santiago y empanada, 24 h; tartas clásicas, 48 h; personalizada, 5 días |
| Raciones                    | 8 (precio de carta), 12 (+8 €), 20 (+18 €)                                  |
| Huecos de recogida          | Cada 30 minutos, hasta 6 pedidos por hueco, con 30 días de antelación como máximo |
| Tamaño máximo por el chat   | 30 unidades; más lo lleva una persona                                      |
| Pago                        | Al recoger, en el obrador                                                  |

## Idiomas

El asistente detecta si el mensaje está en gallego o en castellano en cada turno y contesta en ese idioma, también en los textos que escribe el modelo. La web está en castellano.
