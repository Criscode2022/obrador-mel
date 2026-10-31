// Utilidades de texto para el asistente: normalización (sin tildes, en minúsculas), números
// escritos, parecido entre cadenas y un generador pseudoaleatorio determinista (la ocupación de
// la demo sale de aquí, no de una base de datos).
import { normalize } from '../when.mjs';

export { normalize };

// Palabras → número, en castellano y gallego. Ya sin tildes.
export const NUMBER_WORDS = {
  un: 1, uno: 1, una: 1, unha: 1, dos: 2, dous: 2, duas: 2, tres: 3, cuatro: 4, catro: 4,
  cinco: 5, seis: 6, siete: 7, sete: 7, ocho: 8, oito: 8, nueve: 9, nove: 9, diez: 10, dez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, veinte: 20, vinte: 20,
};

// «2», «dos», «dous» -> 2. null si no es un número.
export function toNumber(word) {
  const w = normalize(word).trim();
  if (/^\d{1,3}$/.test(w)) return Number(w);
  return NUMBER_WORDS[w] ?? null;
}

// Singular aproximado para comparar «cafés» con «café» o «croissants» con «croissant».
export function singular(word) {
  if (word === 'tes') return 'te';
  if (word.length > 4 && word.endsWith('es') && /[snlrdz]es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function trigrams(text) {
  const t = `  ${normalize(text)} `;
  const out = new Set();
  for (let i = 0; i < t.length - 2; i += 1) out.add(t.slice(i, i + 3));
  return out;
}

// Coeficiente de Dice sobre trigramas: 1 es idéntico, 0 no comparten nada.
export function similarity(a, b) {
  const x = trigrams(a);
  const y = trigrams(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const g of x) if (y.has(g)) shared += 1;
  return (2 * shared) / (x.size + y.size);
}

export function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return ((h >>> 0) % 1000003) / 1000003;
}

export const pad2 = (n) => String(n).padStart(2, '0');
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

