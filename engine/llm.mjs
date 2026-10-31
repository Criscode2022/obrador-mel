// Cliente de Ollama, que corre en local: embeddings para la búsqueda y respuestas con contexto.
// Ningún dato sale de la máquina. Si Ollama no responde, quien llama tiene su plan B: la búsqueda
// sigue por palabras y la respuesta se da con el texto de la fuente.
import { readEnv } from './config.mjs';

function ollamaBase() {
  return (readEnv().OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
}

export function chatModel() {
  return readEnv().OLLAMA_CHAT_MODEL || 'qwen3.5:9b-mlx';
}

export function embedModel() {
  return readEnv().OLLAMA_EMBED_MODEL || 'nomic-embed-text';
}

export async function ollamaEmbed(text) {
  const model = embedModel();
  const base = ollamaBase();
  let res = await fetch(`${base}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: text, keep_alive: '10m' }),
  });
  if (res.ok) {
    const data = await res.json();
    const vector = data.embeddings?.[0];
    if (Array.isArray(vector) && vector.length) return { model, vector };
  }
  res = await fetch(`${base}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: text, keep_alive: '10m' }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`ollama embed ${res.status}: ${detail.slice(0, 240)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data.embedding)) throw new Error('ollama embed returned no vector');
  return { model, vector: data.embedding };
}

// Respuesta de varias frases. Falla rápido: el llamador tiene una respuesta determinista de reserva.
// -> { model, content, tokens_in, tokens_out, ms }
export async function ollamaComplete(messages, { numPredict = 220, temperature = 0.2, timeoutMs = 14000 } = {}) {
  const model = chatModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${ollamaBase()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: '10m',
        messages,
        options: { temperature, top_p: 0.9, repeat_penalty: 1.05, num_predict: numPredict },
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`ollama chat ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = await res.json();
    return {
      model,
      content: String(data.message?.content || '').trim(),
      tokens_in: Number(data.prompt_eval_count || 0),
      tokens_out: Number(data.eval_count || 0),
      ms: Date.now() - t0,
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`ollama: sin respuesta en ${timeoutMs} ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Carga en memoria los modelos del chat y de los embeddings (prompt vacío, sin generar nada).
// Así la primera pregunta tras un rato parado no paga el arranque en frío.
export async function warmModels() {
  const base = ollamaBase();
  const jobs = [
    [`${base}/api/generate`, { model: chatModel(), prompt: '', keep_alive: '10m' }],
    [`${base}/api/embed`, { model: embedModel(), input: 'x', keep_alive: '10m' }],
  ];
  await Promise.allSettled(jobs.map(([url, body]) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })));
}
