// Claude API çağrısı. Token verimliliği için: küçük görsel, kısa sabit talimat,
// şemaya bağlı kısa JSON çıktı, düşük max_tokens.
import { planDigest } from './plan.js';

export const MODELS = {
  'claude-haiku-4-5-20251001': { ad: 'Haiku 4.5 (hızlı, ucuz)', inp: 1, out: 5 },
  'claude-sonnet-5-5': { ad: 'Sonnet 5.5 (daha dikkatli)', inp: 2, out: 10 },
};
export const STRONG_MODEL = 'claude-sonnet-5-5';
const IMG_EDGE = 768; // uzun kenar; 768×576 ≈ 590 görsel token

const SYSTEM = `You log food for one person on a weight-loss plan. Reply with JSON only. Write food names, title and q in Turkish.
Input: photo(s) and/or a short text, plus local time and place.
kind: "meal" (food or drink), "weight" (scale reading, set kg), "steps" (step count, set steps), "none" (nothing to log).
For meals: list each item with grams estimated from visual cues (dinner plate ≈ 26 cm, cutlery, hands), include visible oil, sauces and drinks, and when unsure pick the larger plausible portion. Restaurant food ("dışarı") usually carries more fat. kcal, p, c, f, fib are totals for the whole entry.
If the meal clearly matches a plan meal below, set plan to its id and use its numbers; otherwise plan is "".
slot: sabah, ogle, ara1, ara2, aksam, gece, or ant (pre/post-workout banana or skyr) — choose by time and content.
tier: "plan" = fits the plan's foods; "esnek" = weekly-budget items (beer, a small dessert, a restaurant dinner); "yok" = sugary drinks, fried food, chips, salted nuts, pastries (simit, börek, poğaça, kruvasan, bretzel), white bread or toast.
flags: add "alkol" for any alcohol.
conf: 0–1 confidence in the kcal total. q: one short question only if its answer would change kcal by more than 25%, else "".
Plan meals:
${planDigest()}`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'title', 'slot', 'plan', 'items', 'kcal', 'p', 'c', 'f', 'fib', 'tier', 'flags', 'conf', 'q', 'kg', 'steps'],
  properties: {
    kind: { type: 'string', enum: ['meal', 'weight', 'steps', 'none'] },
    title: { type: 'string' },
    slot: { type: 'string', enum: ['sabah', 'ogle', 'ara1', 'ara2', 'aksam', 'gece', 'ant'] },
    plan: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'g', 'kcal', 'p'],
        properties: { n: { type: 'string' }, g: { type: 'number' }, kcal: { type: 'number' }, p: { type: 'number' } },
      },
    },
    kcal: { type: 'number' },
    p: { type: 'number' },
    c: { type: 'number' },
    f: { type: 'number' },
    fib: { type: 'number' },
    tier: { type: 'string', enum: ['plan', 'esnek', 'yok'] },
    flags: { type: 'array', items: { type: 'string' } },
    conf: { type: 'number' },
    q: { type: 'string' },
    kg: { type: 'number' },
    steps: { type: 'number' },
  },
};

// Fotoğrafı cihazda küçültür; hem saklanan hem gönderilen kopya budur.
export async function shrink(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Görsel açılamadı')); };
      img.src = url;
    });
  }
  const w0 = bmp.naturalWidth || bmp.width;
  const h0 = bmp.naturalHeight || bmp.height;
  const k = Math.min(1, IMG_EDGE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.8));
  if (!blob) throw new Error('Görsel küçültülemedi');
  return { blob, w, h };
}

const toB64 = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1]);
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(blob);
});

function parseLoose(text) {
  try { return JSON.parse(text); } catch { /* aşağıda dene */ }
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
  throw new Error('Yanıt okunamadı');
}

export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @param {{apiKey:string, model:string, blobs?:Blob[], text?:string, when:Date, place?:string|null, hint?:string}} o
 * @returns {Promise<{data:object, usage:{in:number,out:number}, model:string}>}
 */
export async function analyze(o) {
  if (!o.apiKey) throw new AiError('no_key', 'API anahtarı girilmemiş');
  const content = [];
  for (const b of (o.blobs || []).slice(0, 3)) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await toB64(b) } });
  }
  const hh = String(o.when.getHours()).padStart(2, '0');
  const mm = String(o.when.getMinutes()).padStart(2, '0');
  const lines = [`Saat ${hh}:${mm}` + (o.place ? `, yer: ${o.place}` : '')];
  if (o.text) lines.push(`Not: ${o.text}`);
  if (o.hint) lines.push(o.hint);
  content.push({ type: 'text', text: lines.join('\n') });

  const body = {
    model: o.model,
    max_tokens: 600,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  };

  const send = async (payload) => {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': o.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new AiError('offline', 'Bağlantı kurulamadı');
    }
    let json = null;
    try { json = await res.json(); } catch { /* gövde yok */ }
    if (!res.ok) {
      const msg = (json && json.error && json.error.message) || `HTTP ${res.status}`;
      const code = res.status === 401 ? 'bad_key' : res.status === 429 ? 'rate' : res.status === 400 ? 'bad_request' : res.status >= 500 ? 'server' : 'http';
      throw new AiError(code, msg);
    }
    return json;
  };

  let json;
  try {
    json = await send(body);
  } catch (e) {
    // Şemalı çıktı reddedilirse aynı isteği şemasız bir kez dene.
    if (e.code === 'bad_request' && /output_config|schema|format/i.test(e.message)) {
      const { output_config, ...rest } = body;
      json = await send(rest);
    } else {
      throw e;
    }
  }
  const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  if (json.stop_reason === 'refusal' || !text) throw new AiError('empty', 'Model yanıt vermedi');
  const data = parseLoose(text);
  const usage = { in: (json.usage && json.usage.input_tokens) || 0, out: (json.usage && json.usage.output_tokens) || 0 };
  return { data, usage, model: o.model };
}

export function costUSD(model, usage) {
  const m = MODELS[model] || MODELS['claude-haiku-4-5-20251001'];
  return (usage.in * m.inp + usage.out * m.out) / 1e6;
}

export const AI_ERR_TR = {
  no_key: 'API anahtarı yok. Ayarlar’dan ekle; kayıt bekliyor.',
  bad_key: 'API anahtarı kabul edilmedi. Ayarlar’dan kontrol et.',
  offline: 'İnternet yok. Kayıt bekliyor; bağlanınca “Analiz et”e dokun.',
  rate: 'Çok sık istek ya da bakiye sınırı. Biraz sonra tekrar dene.',
  server: 'Claude tarafında geçici sorun. Tekrar dene.',
  bad_request: 'İstek reddedildi.',
  empty: 'Model bu girdiyi yorumlayamadı. Kısa bir not ekleyip tekrar dene.',
  http: 'İstek başarısız oldu.',
};
