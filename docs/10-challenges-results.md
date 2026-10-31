---
title: Retos y resultados
---

# Retos y aprendizajes

## «2 tartas de santiago y 1 de limón»

La persona no repite la palabra «tarta», y un buscador de productos se queda solo con la primera. `findItems` hace una segunda pasada: si tras un producto reconocido viene una cantidad o un «otra», toma lo siguiente como sabor y lo prueba con el nombre del producto anterior («tarta de limón»). Cubre también «una de santiago y otra de limón» y listas de tres, cada una con su test.

## «A las 9» no significa lo mismo en todas partes

En una pastelería son las 9:00, en un restaurante, las 21:00. Y «a las 5» en el obrador solo puede ser por la tarde, porque a las 5 de la mañana no abre. `to24` resuelve la hora con el horario del negocio: primero lo que diga la frase («de la tarde»), después qué lectura cae dentro del horario, y al final la costumbre del negocio (`hour_bias`).

## «Mañana» es dos palabras, y en gallego casi tres

«Mañana» es un día y «por la mañana» una parte del día. Además el motor quita las tildes para comparar, y el gallego «mañá» queda en `mana`. `MORNING_RE` borra la parte del día antes de buscar el día, para que «mañá pola mañá» sea mañana por la mañana y no dos cosas.

## La misma pregunta, de cien maneras

«¿A qué hora abrís?», «¿hasta cuándo estáis?», «¿el lunes abrís?», «¿cerráis a mediodía?», «cando abrides?». Son la misma tabla, pero piden cosas distintas: una hora, un sí o un no con el día, una lista de días. `TOPICS` agrupa por familias de frases y `answerHours` decide qué parte de la tabla contestar. Un test pasa diez formas de preguntarlo.

## Un modelo que inventa con seguridad

Un prompt que dice «no inventes» no es una garantía: un modelo puede añadir un plazo razonable que nadie ha escrito, y en una pastelería eso es una promesa falsa. `unsupportedFacts` compara con el contexto cada importe, hora y plazo, y entiende que «dos días» y «2 días» son lo mismo. Lo que no está, tumba la respuesta. Ver [Búsqueda y respuestas](./23-knowledge-base.md).

## El primer mensaje tras un rato parado

Con el modelo descargado, la primera pregunta tarda varias veces más que las siguientes. Si se espera a esa pregunta, el cliente ve el chat colgado. La web pide cargar los modelos en cuanto se abre el chat, antes de que nadie escriba, y el motor limita esa petición a una cada 30 segundos.

## Una ocupación creíble sin datos

Con huecos al azar, cada visita enseñaría una agenda distinta y el mismo hueco estaría libre u ocupado según la recarga. Con un generador con semilla, un mismo hueco está libre u ocupado para todos los visitantes y sigue igual tras reiniciar.

## Lo que encontraron las pruebas

Revisar el código con calma, escribir pruebas contra Postgres y leer conversaciones reales como las leería un cliente sacó a la luz errores que las pruebas unitarias no veían. Están todos arreglados y cada uno tiene su comprobación.

| Error                                                                                     | Por qué se escapaba                                                        |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Una tarjeta en el primer mensaje se quedaba en el resumen del expediente                  | Se tapaba el mensaje guardado, pero el resumen salía del texto original    |
| Un DNI con guion, una nota con DNI o un botón manipulado se guardaban sin tapar           | Tres caminos paralelos al principal                                        |
| «Hola, ¿a qué hora abrís?» recibía un saludo y la pregunta se perdía                      | Bastaba con que el mensaje fuera corto y empezara saludando                |
| «¿Cuánto cuesta el brownie y lleva frutos secos?» perdía el precio                        | La rama de alérgenos ganaba a la del precio                                |
| Un pedido para un día cerrado se pasaba a hoy sin decir nada                              | El aviso se escribía y después se tiraba                                   |
| El documento de cierre de un pedido confirmado decía `pending`                            | Se escribía antes de cambiar el estado                                     |
| Tras aceptar otra hora, la tarjeta seguía con la anterior                                 | La tarjeta se guarda al crear el pedido                                    |
| `+34 655 444 333` no se reconocía como teléfono                                           | Un `\b` tras el prefijo hacía que el prefijo nunca encajara                |
| En el obrador, «a las 3» se leía como las 03:00                                           | Con costumbre de mañana, la lectura de la mañana ganaba aunque no abriera  |
| La respuesta citaba tres fuentes y a veces salía de la cuarta                             | Las citas se cortaban en tres y el contexto llevaba cuatro                 |
| La política de seguridad bloqueaba parte de los estilos, y con ellos las tipografías      | El build de Angular añade un script en línea                               |

La lección de la primera fila vale para todo el proyecto: una regla como «las tarjetas no se guardan» no se cumple tapando en un sitio, sino comprobando todos los sitios donde acaba el dato. El test que la vigila ahora vuelca cada tabla del expediente y busca el número.

# Resultados

- Una web de pastelería completa, con un asistente que lleva un encargo de principio a fin en castellano y gallego.
- El 100 % de los encargos pasa por una persona: no existe un camino en el código que confirme sin aprobación.
- Entre 5 y 30 ms por turno sin modelo, y entre 1 y 2,5 s con el modelo cargado, en un Mac mini.
- 139 tests unitarios, 26 de integración y 10 del servidor web, más 32 conversaciones de extremo a extremo, todos en verde. Los unitarios tardan menos de medio segundo.
- 31 de esas 32 conversaciones pasan sin modelo ni Qdrant: el negocio no depende de la parte que más puede fallar.
- Bundle inicial de 268 kB (76 kB transferidos), con la página en un fragmento aparte de 97 kB.
- Una sola dependencia en el motor.
- Ningún dato sale de la máquina.
