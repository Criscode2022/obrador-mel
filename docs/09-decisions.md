---
title: Decisiones de producto y tech
---

# Decisiones

## El asistente propone, una persona confirma

Un pedido confirmado es un compromiso del negocio con un cliente, y eso no se le puede delegar a un programa que a veces se equivoca. El asistente puede recoger, comprobar y dejar todo preparado, pero nunca cerrar. `chatTurn`, lo que atiende al cliente, no tiene ningún camino a un estado confirmado: solo `staffAct` lo tiene, y exige una aprobación guardada. No es una promesa del prompt, es que el código no permite otra cosa.

El coste es que el cliente espera. A cambio, ningún cliente llega al obrador a por una tarta que nadie aceptó.

## Determinista primero, el modelo al final

Un modelo puede redactar, pero no debe decidir si hay hueco ni cuánto cuesta algo. Por eso el orden es: reglas para entender, datos para contestar, y el modelo solo para lo que quede. Tiene tres consecuencias buenas: la mayoría de los turnos tardan milisegundos en vez de segundos, se pueden probar sin modelo, y los precios y las horas son siempre exactos.

El coste es escribir y mantener las reglas: `nlu.mjs` y `dates.mjs` son muchas expresiones regulares en dos idiomas. Merece la pena porque el dominio es pequeño y cerrado: una pastelería tiene pocas formas de hablar de sí misma.

## El modelo no tiene herramientas

El modelo no puede llamar a funciones ni tocar el pedido. Recibe unas secciones de texto y devuelve una o dos frases. Un modelo sin herramientas no puede hacer nada malo aunque alguien consiga engañarlo: lo peor que puede pasar es una frase mal escrita, y esa frase pasa por la comprobación de cifras.

## Si el modelo inventa una cifra, responde la fuente

Pedirle al modelo que no invente no basta. `unsupportedFacts` saca de cada respuesta los importes, las horas y los plazos, y comprueba que estén en el contexto. Si alguno no está, la respuesta se tira y se contesta con las primeras frases de la mejor sección. La respuesta es peor escrita pero siempre es cierta.

## Modelo local

Los mensajes de los clientes no salen de la máquina: ni al modelo ni a los embeddings. Eso evita la conversación sobre dónde van los datos, no tiene coste por mensaje y permite enseñar la demo sin una clave de API. El coste es el hardware: el modelo necesita unos 12 GB de memoria, y por eso el motor atiende dos conversaciones a la vez y el resto espera.

## Búsqueda híbrida, no solo vectores

Los embeddings encuentran lo parecido en significado, pero fallan con las palabras exactas de un negocio pequeño: «San Clemente», «fondant». Las palabras, al revés. La puntuación final mezcla las dos (60 % palabras, 40 % vectores), y además la búsqueda por palabras funciona sin ningún servicio, lo que da un plan B natural cuando Qdrant o Ollama no están.

## Ocupación sembrada

Una demo sin otros clientes enseñaría todos los huecos libres y no se podría ver cómo se comporta el asistente cuando no hay sitio. En vez de inventar pedidos en la base de datos, la ocupación sale de un generador con semilla: el negocio, el día y la franja dan siempre el mismo número. Es igual para todos los visitantes, sobrevive a los reinicios y no necesita datos. Ver [Disponibilidad](./21-availability.md).

## Los datos del negocio son ficheros

La carta, el horario y el conocimiento son JSON y markdown en el repositorio. Se revisan en un diff, se validan al cargar y se versionan con el código. Una base de datos necesitaría un panel para editarla, y este proyecto no lo tiene.

## Sin framework en el motor

`node:http`, módulos ES y `pg`. El motor tiene doce rutas, y un framework aportaría poco y añadiría dependencias que mantener. Lo mismo con las pruebas: `node --test` viene con Node.

## Sin WebSockets

El chat consulta cada 2,5 segundos mientras hay algo pendiente, y solo entonces. Un socket daría la confirmación un par de segundos antes a cambio de reconexiones, estado en el servidor y un proxy que los soporte. Para un negocio pequeño el sondeo es más simple y sobrevive a cualquier corte.

## Un servidor web con lista cerrada

`serve.mjs` no reenvía lo que le llega: tiene una lista de rutas permitidas, y el resto es un 404 sin tocar el motor. Si mañana el motor gana una ruta de administración, no queda expuesta por accidente. También quita las cabeceras del cliente y aplica los límites antes de gastar nada.

## La CSP manda sobre el rendimiento

La política de seguridad no permite scripts en línea. El build de Angular trae uno para cargar el CSS sin bloquear el primer pintado, y se chocaban: el navegador lo bloqueaba y parte de los estilos no llegaban. Había dos salidas: relajar la política o quitar esa optimización. Se quitó la optimización: el CSS global pesa 2 kB.

## Reservas en el motor, aunque el obrador no las use

El obrador solo necesita pedidos. El motor conserva además las reservas de mesa y las citas con profesional, y cada negocio declara lo que hace en `capabilities`. Es código que la web no usa, y está cubierto con negocios de prueba que solo existen en los tests. Se queda porque demuestra lo que quiere ser el motor: el mismo asistente sirve para otro negocio cambiando sus datos. Ver [Reservas](./22-booking.md).

## Sin cuentas

Un cliente de una pastelería no va a registrarse para preguntar el horario. Una sesión anónima en el navegador basta para separar a los visitantes. Ver [Sesiones y acceso](./06-auth.md).

## Precios en céntimos

`22,00 €` es `2200`. Las sumas son exactas y el formato se decide al enseñarlo.

## Una sola identidad, repetida

«Soy un asistente; una persona lo confirmará» aparece en la cabecera del chat y en los mensajes clave. No es un adorno legal: fija lo que el cliente puede esperar. Un pedido enviado no es un pedido aceptado, y el asistente lo dice cada vez.
