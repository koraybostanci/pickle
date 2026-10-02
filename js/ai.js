// Model calls. Two routes: Claude (Anthropic Messages API) or any OpenAI-compatible endpoint
// (Gemini, OpenCode Zen/Go, OpenRouter…). Kept token-lean: small image, short fixed
// instruction, short JSON output.
import { planDigest } from './plan.js';

export const MODELS = {
  'claude-haiku-4-5-20251001': { name: 'Haiku 4.5 (fast, cheap)', inp: 1, out: 5 },
  'claude-sonnet-5-5': { name: 'Sonnet 5.5 (more careful)', inp: 2, out: 10 },
};
export const STRONG_MODEL = 'claude-sonnet-5-5';
const IMG_EDGE = 768; // long edge; 768×576 is about 590 image tokens

const SYSTEM = `You log food for one person on a weight-loss plan. Reply with JSON only. Write food names, title and q in English.
Input: photo(s) and/or a short text in any language, plus local time and place.
kind: "meal" (food or drink), "weight" (scale reading, set kg), "steps" (step count, set steps), "none" (nothing to log).
For meals: list each item with grams estimated from visual cues (dinner plate ≈ 26 cm, cutlery, hands), include visible oil, sauces and drinks, and when unsure pick the larger plausible portion. Name each item specifically and, where you assumed something you cannot see, say so in brackets: "falafel (assumed fried)", "white cheese (assumed full-fat)". Food eaten "out" usually carries more fat. kcal, p, c, f, fib are totals for the whole entry; kcal equals the sum of the items' kcal.
A note or correction from the person outranks what you see: follow it, drop the matching assumption and do not ask about it again.
If the meal clearly matches a plan meal below, set plan to its id and use its numbers; otherwise plan is "".
slot: morning, lunch, snack1, snack2, dinner, late, or workout (pre/post-workout banana or skyr). Choose by time and content.
tier: "plan" = fits the plan's foods; "flex" = weekly-budget items (beer, a small dessert, a restaurant dinner); "off" = sugary drinks, fried food, crisps, salted nuts, pastries (simit, börek, poğaça, croissant, pretzel), white bread or toast.
flags: add "alcohol" for any alcohol.
conf: 0–1 confidence in the kcal total. q: if something you cannot see (cooking method, fat content, a count, hidden oil or sugar) could change kcal by more than 10%, ask about it in one short line, else "".
Plan meals:
${planDigest()}`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'title', 'slot', 'plan', 'items', 'kcal', 'p', 'c', 'f', 'fib', 'tier', 'flags', 'conf', 'q', 'kg', 'steps'],
  properties: {
    kind: { type: 'string', enum: ['meal', 'weight', 'steps', 'none'] },
    title: { type: 'string' },
    slot: { type: 'string', enum: ['morning', 'lunch', 'snack1', 'snack2', 'dinner', 'late', 'workout'] },
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
    tier: { type: 'string', enum: ['plan', 'flex', 'off'] },
    flags: { type: 'array', items: { type: 'string' } },
    conf: { type: 'number' },
    q: { type: 'string' },
    kg: { type: 'number' },
    steps: { type: 'number' },
  },
};

// Shrinks the photo on the device; this copy is both stored and sent.
export async function shrink(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not open the image')); };
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
  if (!blob) throw new Error('Could not shrink the image');
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
  try { return JSON.parse(t); } catch { /* try below */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new AiError('empty', 'Reply is not JSON');
}

export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Presets for OpenAI-compatible providers. The model name is the provider's own id.
export const PRESETS = [
  { id: 'gemini', name: 'Google Gemini (free tier)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash', alt: ['gemini-3.5-flash-lite', 'gemini-3.8-flash'] },
  { id: 'opencode-zen', name: 'OpenCode Zen (free models)', base: 'https://opencode.ai/zen/v1', model: '' },
  { id: 'opencode-go', name: 'OpenCode Go', base: 'https://opencode.ai/zen/go/v1', model: '' },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: '' },
];
// Free OpenCode Zen ids to try when the /models list cannot be fetched
export const ZEN_FREE = [
  'mimo-v2.5-free', 'mimo-v2.6-flash-free', 'muse-spark-1.3-contributor-free', 'big-pickle', 'space-bunny-free',
  'longcat-2.5-preview-free', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free', 'ling-3.0-flash-fin-free', 'jev-1.13-free',
];

const SHAPE = '\nReturn exactly one JSON object with all of these keys: {"kind":"meal|weight|steps|none","title":"","slot":"morning|lunch|snack1|snack2|dinner|late|workout","plan":"","items":[{"n":"","g":0,"kcal":0,"p":0}],"kcal":0,"p":0,"c":0,"f":0,"fib":0,"tier":"plan|flex|off","flags":[],"conf":0,"q":"","kg":0,"steps":0}';

function classify(status, msg) {
  // 429 is a quota or rate limit, whatever the text says: Gemini's quota message mentions "billing" on the free tier too.
  // "limit: 0" means this model has no quota at all on the account's plan.
  if (status === 429) return /limit:\s*0\b/.test(msg) ? 'no_quota' : 'rate';
  if (status === 402 || /credit balance|insufficient (credit|balance|funds)|payment required/i.test(msg)) return 'no_credit';
  if (/free tier is not available|enable billing|billing account/i.test(msg)) return 'needs_billing';
  if (status === 401 || status === 403) return 'bad_key';
  if (/image|vision|multimodal|modalit/i.test(msg) && (status === 400 || status === 404 || status === 415 || status === 422)) return 'no_vision';
  if (status === 404) return 'bad_model';
  if (status === 400 || status === 422) return 'bad_request';
  if (status >= 500) return 'server';
  return 'http';
}

// When the provider is busy (503 and the like) the request is retried after short waits (ms)
const RETRY_MS = [1200, 3000];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function postOnce(url, headers, payload) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  } catch {
    throw new AiError(navigator.onLine === false ? 'offline' : 'net', 'Could not connect');
  }
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const er = (Array.isArray(json) ? json[0] : json) || {};
    const e = er.error;
    const msg = (e && (e.message || (typeof e === 'string' ? e : ''))) || er.message || `HTTP ${res.status}`;
    throw new AiError(classify(res.status, String(msg)), /HTTP \d+/.test(String(msg)) ? String(msg) : `${msg} (HTTP ${res.status})`);
  }
  return json || {};
}

async function post(url, headers, payload, opts = {}) {
  const tries = opts.retry === false ? 0 : RETRY_MS.length;
  for (let i = 0; ; i++) {
    try {
      return await postOnce(url, headers, payload);
    } catch (e) {
      if (e.code !== 'server' || i >= tries) throw e;
      if (opts.onRetry) opts.onRetry(i + 1, tries);
      await wait(RETRY_MS[i] * (0.85 + Math.random() * 0.3));
    }
  }
}

/**
 * One call. cfg: {provider:'anthropic'|'openai', key, model, base?}
 * @returns {Promise<{text:string, usage:{in:number,out:number}}>}
 */
export async function callModel(cfg, { system, text, blobs = [], schema = null, json = false, maxTokens = 600, retry = true, onRetry = null }) {
  const retryOpts = { retry, onRetry };
  if (!cfg || !cfg.key) throw new AiError('no_key', 'No API key set');
  const imgs = [];
  for (const b of blobs.slice(0, 3)) imgs.push(await toB64(b));

  if (cfg.provider === 'openai') {
    if (!cfg.base || !cfg.model) throw new AiError('no_key', 'No address or model set');
    const content = imgs.map((d) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${d}` } }));
    content.push({ type: 'text', text });
    const body = {
      model: cfg.model,
      max_tokens: Math.max(maxTokens, 1500), // thinking models spend part of the budget on reasoning
      messages: [{ role: 'system', content: system }, { role: 'user', content: imgs.length ? content : text }],
    };
    if (json) body.response_format = { type: 'json_object' };
    const url = cfg.base.replace(/\/+$/, '') + '/chat/completions';
    const headers = { authorization: `Bearer ${cfg.key}` };
    let out;
    try {
      out = await post(url, headers, body, retryOpts);
    } catch (e) {
      if (json && e.code === 'bad_request' && /response_format|json/i.test(e.message)) {
        const { response_format, ...rest } = body;
        out = await post(url, headers, rest, retryOpts);
      } else throw e;
    }
    const msg = out.choices && out.choices[0] && out.choices[0].message;
    let txt = msg ? msg.content : '';
    if (Array.isArray(txt)) txt = txt.filter((c) => c.type === 'text' || typeof c.text === 'string').map((c) => c.text).join('');
    if (!txt) throw new AiError('empty', 'The model returned nothing');
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
    out = await post(url, headers, body, retryOpts);
  } catch (e) {
    // If schema output is rejected, retry the same request once without the schema.
    if (schema && e.code === 'bad_request' && /output_config|schema|format/i.test(e.message)) {
      const { output_config, ...rest } = body;
      out = await post(url, headers, rest, retryOpts);
    } else throw e;
  }
  const txt = (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  if (out.stop_reason === 'refusal' || !txt) throw new AiError('empty', 'The model returned nothing');
  return { text: txt, usage: { in: (out.usage && out.usage.input_tokens) || 0, out: (out.usage && out.usage.output_tokens) || 0 } };
}

/**
 * @param {{cfg:object, blobs?:Blob[], text?:string, when:Date, place?:string|null, hint?:string, onRetry?:Function}} o
 * @returns {Promise<{data:object, usage:{in:number,out:number}, model:string}>}
 */
export async function analyze(o) {
  const hh = String(o.when.getHours()).padStart(2, '0');
  const mm = String(o.when.getMinutes()).padStart(2, '0');
  const lines = [`Time ${hh}:${mm}` + (o.place ? `, place: ${o.place}` : '')];
  if (o.text) lines.push(`Note: ${o.text}`);
  if (o.hint) lines.push(o.hint);
  const openai = o.cfg && o.cfg.provider === 'openai';
  const req = { system: openai ? SYSTEM + SHAPE : SYSTEM, text: lines.join('\n'), blobs: o.blobs || [], schema: openai ? null : SCHEMA, json: true };
  try {
    const r = await callModel(o.cfg, { ...req, onRetry: o.onRetry });
    return { data: parseLoose(r.text), usage: r.usage, model: o.cfg.model };
  } catch (e) {
    if (!FALLBACK_ON.includes(e.code)) throw e;
    // Busy or out of quota (quotas are per model): try the same provider's fallback models once each
    const preset = openai ? PRESETS.find((p) => p.base === o.cfg.base) : null;
    for (const model of ((preset && preset.alt) || []).filter((m) => m !== o.cfg.model)) {
      if (o.onRetry) o.onRetry(0, 0, model, e.code);
      try {
        const r = await callModel({ ...o.cfg, model }, { ...req, retry: false });
        return { data: parseLoose(r.text), usage: r.usage, model, fallbackFrom: e };
      } catch (e2) {
        if (!FALLBACK_ON.includes(e2.code) && e2.code !== 'bad_model') throw e2;
      }
    }
    throw e;
  }
}
const FALLBACK_ON = ['server', 'rate', 'no_quota'];

// The useful part of a provider's error text: for quota errors the limit, the model and the wait, otherwise the start of the message
export function errorDetail(err, max = 200) {
  const msg = String((err && err.message) || '');
  if (err && (err.code === 'rate' || err.code === 'no_quota')) {
    const limit = /limit:\s*(\d+)/.exec(msg);
    const model = /model:\s*([\w.-]+)/.exec(msg);
    const retry = /retry in\s*([\d.]+)\s*s/i.exec(msg);
    const period = /per[\s_]?day/i.test(msg) ? ' a day' : /per[\s_]?minute/i.test(msg) ? ' a minute' : '';
    const parts = [];
    if (limit && model) parts.push(`The limit for ${model[1]} is ${limit[1]} ${limit[1] === '1' ? 'request' : 'requests'}${period}.`);
    else if (limit) parts.push(`The limit is ${limit[1]} ${limit[1] === '1' ? 'request' : 'requests'}${period}.`);
    if (retry && err.code === 'rate') parts.push(`The provider says to retry in ${Math.ceil(+retry[1])} s.`);
    if (parts.length) return parts.join(' ');
  }
  return msg.replace(/\s+/g, ' ').trim().slice(0, max);
}

// Checks that the model really sees photos: it has to read a random number from an image.
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

// Fetches the model list from an OpenAI-compatible endpoint; returns [] on any failure.
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

export const AI_ERRORS = {
  no_key: 'No API key. Add one in Settings; the entry is waiting.',
  bad_key: 'The API key was rejected. Check it in Settings.',
  offline: 'No internet. The entry is waiting; tap “Analyse” once you are back online.',
  net: 'Could not reach the server; the entry is waiting. If you are online, this provider may not allow calls from a browser.',
  rate: 'Too many requests or the quota is used up; the entry is waiting. Tap “Analyse” a little later.',
  no_quota: 'This model has no quota on your plan; the entry is waiting. Pick another model in Settings.',
  no_credit: 'The provider says the account has no credit; the entry is waiting. Add credit or pick another provider in Settings.',
  needs_billing: 'The provider wants billing enabled on this account before it answers; the entry is waiting. Enable it with the provider or pick another one in Settings.',
  no_vision: 'This model does not accept photos. Pick a model with image support in Settings.',
  bad_model: 'Model not found. Check the model name in Settings.',
  server: 'The provider is busy right now; the entry is waiting. Tap “Analyse” a little later.',
  bad_request: 'The request was rejected.',
  empty: 'The model could not interpret this input. Add a short note and try again.',
  http: 'The request failed.',
};
