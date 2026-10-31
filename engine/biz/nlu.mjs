// Comprensión determinista del mensaje de quien escribe a un negocio: idioma, qué quiere
// (reservar, pedir, preguntar...), y los datos sueltos (día, hora, personas, servicios,
// productos, nombre, teléfono). Lo que el cliente dice se contrasta después con el
// negocio: aquí solo se lee, no se decide nada.
import { normalize } from './text.mjs';

// Palabras que solo existen en gallego (sin tildes), para no confundirlo con castellano.
const GL_ONLY = /\b(?:ola|grazas|obrigad[ao]|quero|teno|unha|duas|dous|onde|cando|canto|custa|hoxe|tamen|nome|abrides|pechades|tenen|tedes|podo|gustariame|facer|recoller|levar|moi|moitas|vosa|voso|cousa|cousas|ben|axudar|axuda|bos dias|boas)\b/g;
const ES_ONLY = /\b(?:hola|gracias|quiero|queria|tengo|una|dos|donde|cuando|cuanto|cuesta|hoy|tambien|nombre|abris|cerrais|teneis|puedo|puede|gustaria|hacer|muy|buenos dias|buenas|bien|ayudar|recoger|hasta|vuestra|vuestro|cosa|cosas|cual|cuales|quien|tiene|tienen|sabe|saben|usar|trabaja|trabajado|esperado|proyectos|cuentame|dime|contar|conoce|habla|idiomas|sus|ha|han)\b/g;

export function detectLang(text, prev = 'es') {
  const t = normalize(text);
  const raw = String(text).toLowerCase();
  const gl = (t.match(GL_ONLY) ?? []).length + (/mañá|(?<![\p{L}])ás(?![\p{L}])|(?<![\p{L}])ó(?![\p{L}])/u.test(raw) ? 1 : 0);
  const es = (t.match(ES_ONLY) ?? []).length;
  if (gl > es) return 'gl';
  if (es > gl) return 'es';
  return prev === 'gl' ? 'gl' : 'es';
}

const R = {
  greet: /^(?:ol[aá]|hola|ola|buenas?|buenos dias|bos dias|boas|buenas tardes|boas tardes|buenas noches|boas noites|hey|ey|saludos|que tal|como estas|como va)\b/,
  thanks: /\b(?:obrigad[oa]|gracias|muchas gracias|mil gracias|grazas|moitas grazas|te lo agradezco|vale gracias|genial gracias|perfecto gracias)\b/,
  bye: /^(?:adeus|adios|hasta luego|hasta pronto|chao|chau|nos vemos|ata logo|ata pronto|vale adios|nada mas|eso es todo|ya esta|ya esta todo)\b/,
  yes: /^(?:si|sii|vale|ok|okey|okay|de acuerdo|perfecto|claro|adelante|confirmo|confirmado|correcto|exacto|eso es|dale|venga|por supuesto|sip|afirmativo|enviar|enviarlo|envialo|mandalo|hazlo|apuntalo|ben|certo|de acordo|si por favor|si gracias|si, por favor|genial|estupendo|lo quiero|me va bien|me viene bien|me cuadra|esa|ese)\b/,
  no: /^(?:no|nop|nope|nel|mejor no|todavia no|aun no|no gracias|no, gracias|ninguno|ninguna|nada|paso|non|nin)\b/,
  cancel: /\b(?:cancela|cancelar|cancelalo|anula|anular|anulalo|olvidalo|olvida|dejalo|borra todo|empezar de nuevo|empezar otra vez|de nuevo|reiniciar|reinicia|cancelo)\b/,
  change: /\b(?:cambiar|cambio|cambia|modificar|modifica|otro dia|otra hora|otro horario|mover|mueve|aplazar|retrasar|adelantar)\b/,
  handoff: /\b(?:hablar con (?:una |un )?(?:persona|alguien|humano|encargad[oa]|responsable|jefe|camarer[oa])|con una persona|una persona real|atencion humana|me pasas con|pasame con|llamadme|llamame|que me llame|queja|reclamacion|reclamar|hoja de reclamaciones|hablar con alguien|persoa real|falar con)\b/,
  booking: /\b(?:reserv\w*|mesa|mesas|cita|citas|hueco|huecos|disponibilidad|disponible|turno|agend\w*|apunt\w*|pedir hora|pedir cita|cita previa|quedar|sitio para|sitio libre|plaza|plazas|hora para)\b/,
  orderStrong: /\b(?:pedido|pedir|pido|pedirte|encargo|encargar|encargarte|para recoger|para llevar|para recoller|para levar|recoger|recoller|ponme|poneme|ponedme|dame|dadme|sirveme|preparame|apuntame|me pones|me pondrias|me preparas|me das|nos pones|nos das)\b/,
  want: /\b(?:quiero|queria|quisiera|quero|quereria|me gustaria|nos gustaria|gustariame|necesito|necesitaria|busco|pongame)\b/,
  question: /\?|\b(?:que|cual|cuales|cuanto|cuantos|cuanta|como|donde|cuando|quien|hay|tenei?s|teneis|aceptais|abris|cerrais|puedo|podemos|se puede|es posible|admiten|permiten|lleva|llevan|incluye|incluyen|vale|cuesta|cuestan|precio|precios|horario|abierto|abiertos|cerrado|sirven|hacen|haceis|ofreceis|tienen|dan|existe|teneis|canto|onde|cando|teñen|tedes|abrides|pechades)\b/,
  injection: /\b(?:ignore (?:all |any )?(?:previous|prior|above|your)|disregard (?:the |all )?(?:previous|above)|you are now|act as|pretend (?:to be|you are)|reveal your (?:prompt|instructions)|show (?:me )?your (?:prompt|instructions)|ignora (?:todas? )?(?:tus|las|lo|todo)|ignore (?:all|previous)|olvida (?:tus|todas|las) (?:instrucciones|reglas)|system prompt|prompt del sistema|tus instrucciones|a partir de ahora (?:eres|actua)|actua como|haz de cuenta|eres ahora|modo desarrollador|jailbreak|dan mode|revela (?:tus|el) (?:prompt|instrucciones))\b/,
  abuse: /\b(?:idiota|imbecil|estupid[oa]|gilipollas|mierda|cabron|puta|joder|coño|hijo de|subnormal|basura de bot|inutil)\b/,
  offtopic: /\b(?:chiste|poema|cancion|adivinanza|capital de|quien gano|futbol|bitcoin|politica|presidente|clima en|tiempo en|programa|codigo|python|javascript|traduce|traducir|matematicas|ecuacion|resuelve)\b/,
  asap: /\b(?:ahora mismo|ya mismo|cuanto antes|lo antes posible|en cuanto puedas|de inmediato|ahora|agora|xa mesmo|canto antes)\b/,
  anyone: /\b(?:cualquiera|cualquier(?:a)?|me da igual|da igual|quien sea|con quien sea|indiferente|sin preferencia|el que (?:este|haya|tenga)|lo que haya|calquera|me es igual|me es indiferente)\b/,
  noNotes: /^(?:no|nada|ninguna|ninguno|sin notas|sin nada|ni una|todo bien|no gracias|non|nada mais|nada mas)\b/,
};

// -------------------------------------------------------------- datos de contacto

const NAME_STOP = new Set([
  'si', 'no', 'vale', 'ok', 'hola', 'ola', 'gracias', 'grazas', 'cancela', 'cancelar', 'nada', 'ninguno', 'ninguna',
  'perfecto', 'claro', 'quiero', 'nombre', 'telefono', 'mesa', 'cita', 'pedido', 'cambiar', 'adios', 'buenas',
  'buenos', 'dias', 'tardes', 'noches', 'sin', 'con', 'para', 'por', 'favor', 'que', 'como', 'cuando', 'donde',
  'reserva', 'reservar', 'enviar', 'confirmo', 'confirmar', 'listo', 'ya', 'si,', 'hoy', 'manana', 'ahora',
  'celiaco', 'celiaca', 'vegano', 'vegana', 'alergico', 'alergica', 'intolerante', 'cliente', 'nuevo', 'nueva',
]);

function titleCase(name) {
  return name
    .split(/\s+/)
    .map((w, i) => (['de', 'del', 'la', 'las', 'los', 'da', 'do', 'y', 'e'].includes(w.toLowerCase()) && i > 0
      ? w.toLowerCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

// «a nombre de Iria», «soy Iria Castro», o una respuesta corta cuando se estaba pidiendo el nombre.
export function extractName(text, { expecting = false } = {}) {
  const raw = String(text ?? '').trim();
  const m = raw.match(/\b(a nombre de|a nome de|me llamo|mi nombre es|soy|son|chamome|chámome|o meu nome é|pon(?:lo|erlo)? a nombre de)\s+((?:[\p{L}'-]+)(?:\s+(?:de |del |da |do )?[\p{L}'-]+){0,3})/iu);
  if (m) {
    const bare = /^(?:soy|son)$/i.test(m[1]);
    let words = m[2].split(/\s+/);
    // «soy celíaca», «soy vegano»: solo es un nombre si empieza por mayúscula.
    if (bare && !/^\p{Lu}/u.test(words[0])) return null;
    words = words.filter((w) => !NAME_STOP.has(normalize(w)) && !/\d/.test(w));
    if (words.length) return titleCase(words.slice(0, 3).join(' '));
  }
  if (!expecting) return null;
  const plain = raw.replace(/[.!¡¿?,;:]+$/g, '').trim();
  if (plain.length < 2 || plain.length > 40 || /\d/.test(plain)) return null;
  const parts = plain.split(/\s+/);
  if (parts.length > 4) return null;
  if (parts.some((w) => NAME_STOP.has(normalize(w)))) return null;
  if (!/^[\p{L}][\p{L}' .-]*$/u.test(plain)) return null;
  return titleCase(plain);
}

export function extractPhone(text) {
  const m = String(text ?? '').replace(/(\d)[\s.-](?=\d)/g, '$1').match(/(?:\+34|0034)?\b([6-9]\d{8})\b/);
  return m ? m[1] : null;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
export function extractEmail(text) {
  const m = String(text ?? '').match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}
