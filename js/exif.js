// Small EXIF reader: capture time and GPS position from a JPEG.
// The photo is read here before it leaves the device; no metadata goes into the analysis request.

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATETIME = 0x0132;
const TAG_DATETIME_ORIGINAL = 0x9003;

function readIFD(view, tiff, off, le) {
  const out = new Map();
  if (off <= 0 || tiff + off + 2 > view.byteLength) return out;
  const n = view.getUint16(tiff + off, le);
  for (let i = 0; i < n; i++) {
    const e = tiff + off + 2 + i * 12;
    if (e + 12 > view.byteLength) break;
    out.set(view.getUint16(e, le), {
      type: view.getUint16(e + 2, le),
      count: view.getUint32(e + 4, le),
      valueOff: e + 8,
    });
  }
  return out;
}

function ascii(view, tiff, ent, le) {
  if (!ent) return '';
  const start = ent.count <= 4 ? ent.valueOff : tiff + view.getUint32(ent.valueOff, le);
  if (start + ent.count > view.byteLength) return '';
  let s = '';
  for (let i = 0; i < ent.count; i++) {
    const c = view.getUint8(start + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function rationals(view, tiff, ent, le) {
  if (!ent) return null;
  const start = tiff + view.getUint32(ent.valueOff, le);
  if (start + ent.count * 8 > view.byteLength) return null;
  const out = [];
  for (let i = 0; i < ent.count; i++) {
    const num = view.getUint32(start + i * 8, le);
    const den = view.getUint32(start + i * 8 + 4, le);
    out.push(den ? num / den : 0);
  }
  return out;
}

function parseDate(s) {
  // "YYYY:MM:DD HH:MM:SS", read as local time
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (Number.isNaN(d.getTime()) || +m[1] < 2000) return null;
  return d.getTime();
}

export function parseExif(buf) {
  const view = new DataView(buf);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {};
  let p = 2;
  while (p + 4 <= view.byteLength) {
    if (view.getUint8(p) !== 0xff) break;
    const marker = view.getUint8(p + 1);
    const size = view.getUint16(p + 2);
    if (marker === 0xe1 && p + 10 <= view.byteLength && view.getUint32(p + 4) === 0x45786966) {
      const tiff = p + 10;
      if (tiff + 8 > view.byteLength) return {};
      const le = view.getUint16(tiff) === 0x4949;
      const ifd0 = readIFD(view, tiff, view.getUint32(tiff + 4, le), le);
      const res = {};
      const exifPtr = ifd0.get(TAG_EXIF_IFD);
      let ts = null;
      if (exifPtr) {
        const ex = readIFD(view, tiff, view.getUint32(exifPtr.valueOff, le), le);
        ts = parseDate(ascii(view, tiff, ex.get(TAG_DATETIME_ORIGINAL), le));
      }
      if (!ts) ts = parseDate(ascii(view, tiff, ifd0.get(TAG_DATETIME), le));
      if (ts) res.ts = ts;
      const gpsPtr = ifd0.get(TAG_GPS_IFD);
      if (gpsPtr) {
        const g = readIFD(view, tiff, view.getUint32(gpsPtr.valueOff, le), le);
        const lat = rationals(view, tiff, g.get(2), le);
        const lon = rationals(view, tiff, g.get(4), le);
        const latRef = ascii(view, tiff, g.get(1), le);
        const lonRef = ascii(view, tiff, g.get(3), le);
        if (lat && lon && lat.length === 3 && lon.length === 3) {
          let la = lat[0] + lat[1] / 60 + lat[2] / 3600;
          let lo = lon[0] + lon[1] / 60 + lon[2] / 3600;
          if (latRef === 'S') la = -la;
          if (lonRef === 'W') lo = -lo;
          if (Math.abs(la) <= 90 && Math.abs(lo) <= 180 && (la !== 0 || lo !== 0)) {
            res.lat = la;
            res.lon = lo;
          }
        }
      }
      return res;
    }
    if (marker === 0xda) break; // image data starts here
    p += 2 + size;
  }
  return {};
}

// Reads only the start of the file (EXIF sits in the first blocks).
export async function readMeta(file) {
  try {
    const buf = await file.slice(0, 262144).arrayBuffer();
    return parseExif(buf);
  } catch {
    return {};
  }
}

export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Matches the position to saved places on the device; the model only gets a one-word label.
export function placeLabel(lat, lon, places) {
  if (lat == null || lon == null) return null;
  for (const pl of places || []) {
    if (distanceM(lat, lon, pl.lat, pl.lon) < 150) return pl.name;
  }
  return 'out';
}
