---
title: Testing · integración
---

# Testing · integración

Dos ficheros que prueban piezas reales juntas: el motor contra un Postgres de verdad, y el servidor web como un proceso aparte.

## El recorrido contra Postgres (`engine/test/flow.test.mjs`)

26 tests. Llaman directamente a `chatTurn` y `staffAct`, las funciones que hay detrás de las rutas, con el reloj fijado y una sesión nueva por test, así que pueden correr sobre una base con datos.

```bash
./scripts/up.sh
npm --prefix engine run test:integration
```

Ollama y Qdrant apuntan a un puerto cerrado a propósito:

```js
process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:9';
process.env.QDRANT_URL = 'http://127.0.0.1:9';
```

| Grupo                | Tests | Comprueba                                                                          |
| -------------------- | ----- | ---------------------------------------------------------------------------------- |
| Confirmar y cerrar   | 5     | Solo se cierra si alguien confirma; rastro en orden; markdown; rechazar; no decidir dos veces |
| Otra hora            | 4     | Aceptar mueve el pedido y su tarjeta; rechazar lo devuelve; idioma; huecos inexistentes |
| Una persona responde | 3     | Pregunta sin respuesta, revisión y respuesta sin modelo                            |
| Varias conversaciones | 4    | Pregunta aparte, otro pedido, tras cerrar, y la agenda                             |
| Aislamiento          | 2     | Cada visitante solo ve lo suyo; entradas inválidas                                 |
| Datos personales     | 6     | Tarjetas, DNI y resúmenes en todas las tablas                                      |
| Límites              | 2     | Eventos solo de añadir; tope de expedientes                                        |

### Lo que más vale

La prueba de privacidad no mira una columna: vuelca todo lo que se ha guardado de un expediente y busca el dato.

```js
async function everything(caseId) {
  const q = async (sql) => JSON.stringify(await rows(sql, caseId));
  return (await Promise.all([
    q('SELECT summary FROM cases WHERE id = $1'),
    q('SELECT content, meta FROM messages WHERE case_id = $1'),
    q('SELECT data, dialog FROM biz_requests WHERE case_id = $1'),
    q('SELECT payload FROM events WHERE case_id = $1'),
    q('SELECT draft FROM proposals WHERE case_id = $1'),
  ])).join('\n');
}

test('una tarjeta en el primer mensaje no llega a la base de datos', async () => {
  const out = await say(newSession(), undefined, `hola, mi tarjeta es ${CARD}`);
  assert.equal(out.state, 'refused');
  const stored = await everything(out.case_id);
  assert.ok(!stored.includes('4111'), stored);
  assert.match(stored, /\[TARJETA\]/);
});
```

Mirar todas las tablas, y no solo `messages`, es lo que hace que esta prueba vea un resumen sin tapar.

## El servidor web (`web/serve.test.mjs`)

10 tests. Arrancan `serve.mjs` como proceso aparte contra un motor de mentira que apunta lo que le llega, porque lo importante es lo que **no** deja pasar.

```bash
npm --prefix web test
```

| Test                                     | Comprueba                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| Lista cerrada                            | Las rutas fuera de la lista dan 404 y el motor no recibe nada            |
| Cabeceras                                | Cookies, `Authorization` y `X-Forwarded-For` no llegan al motor          |
| Cuerpo grande                            | Se corta antes del motor                                                 |
| Ficheros                                 | Portada, caché por tipo y sin salirse de la carpeta, también con `%2f`   |
| Rutas y ficheros que no existen          | 404 para un fichero y portada para una ruta                              |
| Cabeceras de seguridad                   | En todas las respuestas, también en los errores                          |
| Motor caído                              | 502 con un mensaje que se entiende                                       |
| Ritmo                                    | 40 mensajes por minuto, y `X-Forwarded-For` inventado no se lo salta     |
| Proxy de confianza                       | Con `TRUST_PROXY=1`, cada dirección tiene su límite                      |
