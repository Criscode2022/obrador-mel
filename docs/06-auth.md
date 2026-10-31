---
title: Sesiones y acceso
---

# Sesiones y acceso

Obrador Mel no tiene cuentas, ni contraseñas, ni cookies. Un cliente que entra en la web de una pastelería quiere preguntar a qué hora abre, no registrarse. Lo que sí necesita el motor es separar a un visitante de otro, y eso lo hace una sesión anónima.

## La sesión

La primera vez que el navegador la necesita, `BizApi` genera 16 bytes aleatorios con `crypto.getRandomValues` y los guarda en `localStorage` como 32 caracteres hexadecimales.

```ts
get session(): string {
  let s = this.read(SESSION_KEY);
  if (!s || !/^[a-f0-9]{32}$/.test(s)) {
    s = randomHex(16);
    this.write(SESSION_KEY, s);
  }
  return s;
}
```

Esos 128 bits no se pueden adivinar, y son la única prueba de quién es quién: el que tiene la sesión ve lo suyo. Si no hay `localStorage` (una ventana privada que lo bloquea), la sesión vive en memoria y dura lo que la pestaña.

| Clave                  | Dónde        | Contenido                               |
| ---------------------- | ------------ | --------------------------------------- |
| `obrador-session`      | localStorage | La sesión                               |
| `obrador-case-<slug>`  | localStorage | El expediente abierto en ese negocio    |

Al recargar la página, el chat recupera la conversación con esas dos claves.

## Cómo se separan los visitantes

Todas las lecturas y escrituras de un expediente filtran por negocio y por sesión en la propia consulta:

```js
const { rows } = await pool.query(
  'SELECT * FROM cases WHERE id = $1 AND business = $2 AND session_id = $3',
  [id, slug, session],
);
```

Conocer el número de expediente de otro no sirve de nada: la consulta no lo devuelve y la respuesta es la misma que si no existiera. Un test lo comprueba con dos sesiones: la ajena no ve la conversación, no ve la solicitud en el panel, recibe un 404 si intenta confirmarla y, si manda un mensaje con ese expediente, se le abre uno nuevo.

## El panel del local

En una demo pública, el panel está abierto a propósito: enseñar el lado del negocio es la mitad de lo que se quiere demostrar. Por eso cada visitante hace de local **solo para sus propias pruebas**. No ve lo de nadie más, y nadie puede confirmar lo suyo.

El actor que queda en la tabla `approvals` es `local (demostración)`, para que el rastro diga la verdad sobre quién decidió.

## Lo que haría falta en un negocio real

Esta es la diferencia más grande entre la demo y un producto. Para usarlo de verdad, el panel tendría que:

- Estar detrás de un acceso con cuentas del personal, en una ruta propia.
- Ver todas las solicitudes del negocio, no las de una sesión: `staffList` filtraría solo por `business`.
- Guardar en `approvals.actor` quién confirmó.

El resto no cambia. El motor ya separa el acceso del cliente de la decisión de la persona: `chatTurn` no puede confirmar nada, y `staffAct` es el único camino a un estado confirmado.

## Lo que no hay

- **Sin datos de pago:** no hay proveedor de pagos ni se piden tarjetas.
- **Sin analítica ni terceros:** las tipografías se sirven desde el mismo dominio y no hay scripts externos.
- **Sin CSRF que proteger:** no hay cookies, así que el navegador no adjunta ninguna credencial por su cuenta.
