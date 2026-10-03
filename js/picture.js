// Plan pictures: every photo gets the same treatment before it is stored, so the meals look like one set.
// The original file is never kept. What is stored is a square crop with corrected white balance,
// exposure, a little contrast and colour and a soft falloff towards the rim, re-encoded without the
// photo's metadata (no location, no capture time, no camera details).

export const PICTURE_SIZE = 640; // stored edge, px
const WORK_EDGE = 1280; // working copy; large enough to zoom in on

// Opens a photo file as something that can be drawn, with its orientation applied
export async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not open the image')); };
      img.src = url;
    });
  }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Corrects the tones of a canvas in place.
 * - White balance: the colour of the light is read from the bright things that are closest to neutral
 *   (the plate, skyr, cheese, egg white) and removed. A cast is trusted only if it looks like light:
 *   warm or cool, and not stronger than a lamp makes it. Bright food that simply has a colour (a bowl of
 *   soup, a salad) is left alone.
 * - Exposure: the darkest and brightest half percent are stretched to the ends, the middle is nudged towards mid-grey.
 * - A mild contrast curve and a little more colour.
 * All corrections are capped, so a photo that is already fine barely changes and nothing ends up looking filtered.
 */
export function tone(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const step = 4 * 4; // sample every 4th pixel for the statistics
  const percentile = (hg, total, q) => { let acc = 0; for (let v = 0; v < hg.length; v++) { acc += hg[v]; if (acc >= total * q) return v; } return hg.length - 1; };
  const lumOf = (r, g, b) => (r * 54 + g * 183 + b * 19) >> 8;
  const satOf = (r, g, b) => { const mx = Math.max(r, g, b); return Math.round(((mx - Math.min(r, g, b)) / (mx || 1)) * 100); };

  // 1) White balance
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i += step) { hist[lumOf(d[i], d[i + 1], d[i + 2])] += 1; n += 1; }
  const bright = percentile(hist, n, 0.9);
  const isCandidate = (r, g, b) => lumOf(r, g, b) >= bright && Math.max(r, g, b) < 250; // bright, not blown out
  const satHist = new Uint32Array(101);
  let cand = 0;
  for (let i = 0; i < d.length; i += step) {
    if (isCandidate(d[i], d[i + 1], d[i + 2])) { satHist[satOf(d[i], d[i + 1], d[i + 2])] += 1; cand += 1; }
  }
  let gr = 1; let gg = 1; let gb = 1;
  if (cand > n * 0.004) {
    const neutral = percentile(satHist, cand, 0.3); // the least coloured third of the bright pixels
    let sr = 0; let sg = 0; let sb = 0;
    for (let i = 0; i < d.length; i += step) {
      const r = d[i]; const g = d[i + 1]; const b = d[i + 2];
      if (isCandidate(r, g, b) && satOf(r, g, b) <= neutral) { sr += r; sg += g; sb += b; }
    }
    if (sr > 0 && sg > 0 && sb > 0) {
      const mx = Math.max(sr, sg, sb);
      const cast = (mx - Math.min(sr, sg, sb)) / mx;
      let k = 0.9 * clamp(1 - (cast - 0.34) / 0.21, 0, 1); // beyond what a lamp does, it is the food's own colour
      const u = Math.log(sr / sg);
      const v = Math.log(sb / sg);
      if (u * v > 0 && Math.min(Math.abs(u), Math.abs(v)) > 0.03) k *= 0.35; // green or magenta is rarely the light
      const grey = (sr + sg + sb) / 3;
      gr = clamp(1 + (grey / sr - 1) * k, 0.72, 1.4);
      gg = clamp(1 + (grey / sg - 1) * k, 0.85, 1.18);
      gb = clamp(1 + (grey / sb - 1) * k, 0.72, 1.4);
    }
  }

  // 2) Exposure, measured after the white balance
  const hist2 = new Uint32Array(256);
  for (let i = 0; i < d.length; i += step) {
    const l = (Math.min(255, d[i] * gr) * 54 + Math.min(255, d[i + 1] * gg) * 183 + Math.min(255, d[i + 2] * gb) * 19) >> 8;
    hist2[l] += 1;
  }
  const lo = Math.min(percentile(hist2, n, 0.005), 48);
  const hi = Math.max(percentile(hist2, n, 0.995), 185);
  const mid = clamp((percentile(hist2, n, 0.5) - lo) / (hi - lo), 0.05, 0.95);
  const gamma = clamp(Math.log(0.5) / Math.log(mid), 0.75, 1.25); // median towards mid-grey, gently
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let x = clamp((v - lo) / (hi - lo), 0, 1);
    x = Math.pow(x, gamma);
    x -= 0.035 * Math.sin(2 * Math.PI * x); // mild S-curve: shadows a touch deeper, highlights a touch brighter
    lut[v] = Math.round(clamp(x, 0, 1) * 249 + 3);
  }

  // 3) Apply, with a little more colour
  const sat = 1.1;
  for (let i = 0; i < d.length; i += 4) {
    const r = lut[Math.min(255, Math.round(d[i] * gr))];
    const g = lut[Math.min(255, Math.round(d[i + 1] * gg))];
    const b = lut[Math.min(255, Math.round(d[i + 2] * gb))];
    const l = (r * 54 + g * 183 + b * 19) / 256;
    d[i] = l + (r - l) * sat;
    d[i + 1] = l + (g - l) * sat;
    d[i + 2] = l + (b - l) * sat;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Opens a photo as a working canvas with the tone treatment applied. */
export async function prepare(file) {
  const bmp = await decode(file);
  const w0 = bmp.naturalWidth || bmp.width;
  const h0 = bmp.naturalHeight || bmp.height;
  const k = Math.min(1, WORK_EDGE / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w0 * k));
  canvas.height = Math.max(1, Math.round(h0 * k));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; // a transparent PNG would turn black as a JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try { ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height); } finally { if (bmp.close) bmp.close(); }
  tone(canvas);
  return canvas;
}

/**
 * The square that will be stored. zoom 1 shows as much as fits; cx, cy are the centre in source pixels.
 * Returns the source rectangle, kept inside the photo.
 */
export function frameRect(src, zoom, cx, cy) {
  const side = Math.min(src.width, src.height) / Math.max(1, zoom);
  const x = clamp(cx - side / 2, 0, src.width - side);
  const y = clamp(cy - side / 2, 0, src.height - side);
  return { x, y, side };
}

export function drawFrame(target, src, zoom, cx, cy) {
  const { x, y, side } = frameRect(src, zoom, cx, cy);
  const ctx = target.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, side, side, 0, 0, target.width, target.height);
  // The same soft falloff towards the rim on every picture, as if all were lit from above
  const c = target.width / 2;
  const fall = ctx.createRadialGradient(c, c, c * 0.55, c, c, c);
  fall.addColorStop(0, 'rgb(0 0 0 / 0)');
  fall.addColorStop(0.5, 'rgb(0 0 0 / 0.05)');
  fall.addColorStop(1, 'rgb(0 0 0 / 0.16)');
  ctx.fillStyle = fall;
  ctx.fillRect(0, 0, target.width, target.height);
}

/** The stored picture: a square JPEG of the chosen frame. */
export async function render(src, zoom = 1, cx = src.width / 2, cy = src.height / 2) {
  const out = document.createElement('canvas');
  out.width = PICTURE_SIZE;
  out.height = PICTURE_SIZE;
  drawFrame(out, src, zoom, cx, cy);
  const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.86));
  out.width = 0; // gives the canvas memory back: Safari limits the total
  if (!blob) throw new Error('Could not save the picture');
  return blob;
}
