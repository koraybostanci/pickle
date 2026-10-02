// Model çağrısı. İki yol: Claude (Anthropic Messages API) ya da OpenAI uyumlu bir uç
// (OpenCode Zen/Go, Gemini, OpenRouter…). Token verimliliği için: küçük görsel,
// kısa sabit talimat, kısa JSON çıktı.
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
  const t = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  try { return JSON.parse(t); } catch { /* aşağıda dene */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new AiError('empty', 'Yanıt JSON değil');
}

export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// OpenAI uyumlu sağlayıcılar için hazır ayarlar. Model adı sağlayıcının kendi kimliğidir.
export const PRESETS = [
  { id: 'opencode-zen', ad: 'OpenCode Zen (ücretsiz modeller)', base: 'https://opencode.ai/zen/v1', model: '' },
  { id: 'opencode-go', ad: 'OpenCode Go', base: 'https://opencode.ai/zen/go/v1', model: '' },
  { id: 'gemini', ad: 'Google Gemini (ücretsiz katman)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash' },
  { id: 'openrouter', ad: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: '' },
];
// /models listesi alınamazsa denenecek ücretsiz OpenCode Zen kimlikleri
export const ZEN_FREE = [
  'mimo-v2.5-free', 'mimo-v2.6-flash-free', 'muse-spark-1.3-contributor-free', 'big-pickle', 'space-bunny-free',
  'longcat-2.5-preview-free', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free', 'ling-3.0-flash-fin-free', 'jev-1.13-free',
];

const SHAPE = '\nReturn exactly one JSON object with all of these keys: {"kind":"meal|weight|steps|none","title":"","slot":"sabah|ogle|ara1|ara2|aksam|gece|ant","plan":"","items":[{"n":"","g":0,"kcal":0,"p":0}],"kcal":0,"p":0,"c":0,"f":0,"fib":0,"tier":"plan|esnek|yok","flags":[],"conf":0,"q":"","kg":0,"steps":0}';

function classify(status, msg) {
  if (/credit balance|insufficient (credit|balance|quota|funds)|billing|payment required/i.test(msg) || status === 402) return 'no_credit';
  if (status === 401 || status === 403) return 'bad_key';
  if (status === 429) return 'rate';
  if (/image|vision|multimodal|modalit/i.test(msg) && (status === 400 || status === 404 || status === 415 || status === 422)) return 'no_vision';
  if (status === 404) return 'bad_model';
  if (status === 400 || status === 422) return 'bad_request';
  if (status >= 500) return 'server';
  return 'http';
}

async function post(url, headers, payload) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  } catch {
    throw new AiError(navigator.onLine === false ? 'offline' : 'net', 'Bağlantı kurulamadı');
  }
  let json = null;
  try { json = await res.json(); } catch { /* gövde yok */ }
  if (!res.ok) {
    const er = json && json.error;
    const msg = (er && (er.message || (typeof er === 'string' ? er : ''))) || (json && json.message) || `HTTP ${res.status}`;
    throw new AiError(classify(res.status, String(msg)), String(msg));
  }
  return json || {};
}

/**
 * Tek çağrı. cfg: {provider:'anthropic'|'openai', key, model, base?}
 * @returns {Promise<{text:string, usage:{in:number,out:number}}>}
 */
export async function callModel(cfg, { system, text, blobs = [], schema = null, json = false, maxTokens = 600 }) {
  if (!cfg || !cfg.key) throw new AiError('no_key', 'API anahtarı girilmemiş');
  const imgs = [];
  for (const b of blobs.slice(0, 3)) imgs.push(await toB64(b));

  if (cfg.provider === 'openai') {
    if (!cfg.base || !cfg.model) throw new AiError('no_key', 'Adres ya da model girilmemiş');
    const content = imgs.map((d) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${d}` } }));
    content.push({ type: 'text', text });
    const body = {
      model: cfg.model,
      max_tokens: Math.max(maxTokens, 1500), // düşünen modeller payın bir kısmını düşünmeye harcar
      messages: [{ role: 'system', content: system }, { role: 'user', content: imgs.length ? content : text }],
    };
    if (json) body.response_format = { type: 'json_object' };
    const url = cfg.base.replace(/\/+$/, '') + '/chat/completions';
    const headers = { authorization: `Bearer ${cfg.key}` };
    let out;
    try {
      out = await post(url, headers, body);
    } catch (e) {
      if (json && e.code === 'bad_request' && /response_format|json/i.test(e.message)) {
        const { response_format, ...rest } = body;
        out = await post(url, headers, rest);
      } else throw e;
    }
    const msg = out.choices && out.choices[0] && out.choices[0].message;
    let txt = msg ? msg.content : '';
    if (Array.isArray(txt)) txt = txt.filter((c) => c.type === 'text' || typeof c.text === 'string').map((c) => c.text).join('');
    if (!txt) throw new AiError('empty', 'Model yanıt vermedi');
    const u = out.usage || {};
    return { text: String(txt), usage: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 } };
  }

  const content = imgs.map((d) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } }));
  content.push({ type: 'text', text });
  const body = { model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  if (schema) body.output_config = { format: { type: 'json_schema', schema } };
  const headers = { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  const url = 'https://api.anthropic.com/v1/messages';
  let out;
  try {
    out = await post(url, headers, body);
  } catch (e) {
    // Şemalı çıktı reddedilirse aynı isteği şemasız bir kez dene.
    if (schema && e.code === 'bad_request' && /output_config|schema|format/i.test(e.message)) {
      const { output_config, ...rest } = body;
      out = await post(url, headers, rest);
    } else throw e;
  }
  const txt = (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  if (out.stop_reason === 'refusal' || !txt) throw new AiError('empty', 'Model yanıt vermedi');
  return { text: txt, usage: { in: (out.usage && out.usage.input_tokens) || 0, out: (out.usage && out.usage.output_tokens) || 0 } };
}

/**
 * @param {{cfg:object, blobs?:Blob[], text?:string, when:Date, place?:string|null, hint?:string}} o
 * @returns {Promise<{data:object, usage:{in:number,out:number}, model:string}>}
 */
export async function analyze(o) {
  const hh = String(o.when.getHours()).padStart(2, '0');
  const mm = String(o.when.getMinutes()).padStart(2, '0');
  const lines = [`Saat ${hh}:${mm}` + (o.place ? `, yer: ${o.place}` : '')];
  if (o.text) lines.push(`Not: ${o.text}`);
  if (o.hint) lines.push(o.hint);
  const openai = o.cfg && o.cfg.provider === 'openai';
  const r = await callModel(o.cfg, {
    system: openai ? SYSTEM + SHAPE : SYSTEM,
    text: lines.join('\n'),
    blobs: o.blobs || [],
    schema: openai ? null : SCHEMA,
    json: true,
  });
  return { data: parseLoose(r.text), usage: r.usage, model: o.cfg.model };
}

// Modelin fotoğrafı gerçekten görüp görmediğini sınar: rastgele bir sayıyı resimden okutur.
export async function probeVision(cfg) {
  const n = String(1000 + Math.floor(Math.random() * 9000));
  const cv = document.createElement('canvas');
  cv.width = 320;
  cv.height = 160;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 320, 160);
  g.fillStyle = '#000';
  g.font = 'bold 96px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(n, 160, 84);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.9));
  const r = await callModel(cfg, { system: 'You read numbers from images.', text: 'Reply with only the number shown in the image.', blobs: [blob], maxTokens: 300 });
  return { ok: r.text.replace(/\D/g, '').includes(n), usage: r.usage };
}

// OpenAI uyumlu uçta model listesini dener; olmazsa boş döner.
export async function listModels(cfg) {
  try {
    const res = await fetch(cfg.base.replace(/\/+$/, '') + '/models', { headers: { authorization: `Bearer ${cfg.key}` } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.data || []).map((m) => m.id).filter(Boolean);
  } catch {
    return [];
  }
}

export function costUSD(model, usage) {
  const m = MODELS[model];
  return m ? (usage.in * m.inp + usage.out * m.out) / 1e6 : 0;
}

export const AI_ERR_TR = {
  no_key: 'API anahtarı yok. Ayarlar’dan ekle; kayıt bekliyor.',
  bad_key: 'API anahtarı kabul edilmedi. Ayarlar’dan kontrol et.',
  offline: 'İnternet yok. Kayıt bekliyor; bağlanınca “Analiz et”e dokun.',
  net: 'Sunucuya ulaşılamadı; kayıt bekliyor. İnternet varsa bu sağlayıcı tarayıcıdan çağrıya izin vermiyor olabilir.',
  rate: 'Çok sık istek ya da kota sınırı. Biraz sonra tekrar dene.',
  no_credit: 'Hesapta kredi yok; kayıt bekliyor. Kredi al ya da Ayarlar’dan başka bir sağlayıcı seç.',
  no_vision: 'Bu model fotoğraf kabul etmiyor. Ayarlar’dan görsel destekleyen bir model seç.',
  bad_model: 'Model bulunamadı. Ayarlar’da model adını kontrol et.',
  server: 'Sağlayıcı tarafında geçici sorun. Tekrar dene.',
  bad_request: 'İstek reddedildi.',
  empty: 'Model bu girdiyi yorumlayamadı. Kısa bir not ekleyip tekrar dene.',
  http: 'İstek başarısız oldu.',
};
