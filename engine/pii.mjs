// Datos personales de un mensaje. Determinista: ningún modelo decide qué es sensible.
//   scrub     tapa lo que nunca se guarda (tarjetas con dígito de control válido y DNI/NIE)
//   redact    además tapa el correo y el teléfono, para los resúmenes
//   classify  dice qué datos personales trae el mensaje, de más a menos sensible
const PII_RANK = ['minor', 'health', 'dni', 'card', 'phone', 'email'];

const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
const DNI_RE = /\b[XYZ]?\d{7,8}[\s-]?[A-HJ-NP-TV-Z]\b/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+34|0034)?[\s.-]*[6-9]\d{8}\b/g;
const PHONE_LABELED_RE = /(?:tel[eé]fono|tlf\.?|m[oó]vil|phone)\s*[:.]?\s*\+?\d[\d\s.-]{8,}/gi;

function resetRe() {
  for (const re of [CARD_RE, DNI_RE, EMAIL_RE, PHONE_RE, PHONE_LABELED_RE]) re.lastIndex = 0;
}

export function luhn(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// -> { text: texto sin datos que nunca se guardan, flags: ['card', 'dni'] }
export function scrub(text) {
  resetRe();
  let out = String(text ?? '');
  const flags = [];
  out = out.replace(CARD_RE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      flags.push('card');
      return '[TARJETA]';
    }
    return m;
  });
  if (DNI_RE.test(out)) {
    flags.push('dni');
    DNI_RE.lastIndex = 0;
    out = out.replace(DNI_RE, '[DNI]');
  }
  resetRe();
  return { text: out, flags };
}

export function redact(text) {
  resetRe();
  return scrub(text).text
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(PHONE_RE, '[TEL]')
    .replace(PHONE_LABELED_RE, '[TEL]');
}

// -> { pii: ['dni', 'phone'], pii_level: 'dni', redacted_text }
export function classify(text) {
  const raw = String(text ?? '');
  const pii = [];
  resetRe();
  const { flags } = scrub(raw);
  if (flags.includes('dni')) pii.push('dni');
  if (flags.includes('card')) pii.push('card');
  resetRe();
  if (PHONE_RE.test(raw) || PHONE_LABELED_RE.test(raw)) pii.push('phone');
  resetRe();
  if (EMAIL_RE.test(raw)) pii.push('email');
  resetRe();
  if (/\b(antibi[oó]tico|diagn[oó]stic|s[ií]ntoma|enfermedad|hospital|paciente|depresi[oó]n|c[aá]ncer|medicaci[oó]n|salud)\b/i.test(raw)) {
    pii.push('health');
  }
  if (/\b(menor(?:\s+de\s+edad)?|niñ[oa]s?|hijo|hija|filla|fillo|neno|nena)\b/i.test(raw) && /\b(\d{1,2}\s*años|menor)\b/i.test(raw)) {
    pii.push('minor');
  }
  return { pii, pii_level: PII_RANK.find((level) => pii.includes(level)) ?? 'none', redacted_text: redact(raw) };
}
