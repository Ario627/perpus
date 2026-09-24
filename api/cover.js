import { toIsbn13 } from "../isbn-validate.js";

const TIMEOUT_MS = 8000;
const MIN_BYTES = 3000;
const MAX_BYTES = 3000000;
const CACHE_HIT = "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=604800";
const CACHE_MISS = "public, max-age=600";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GRAYSCALE_PNG = new Set([0, 4]);
const PLACEHOLDER_PNG = [[128, 170], [256, 340], [180, 233]];

function userAgent() {
  const contact = process.env.OPEN_LIBRARY_CONTACT?.trim();
  return contact ? `KatalogPerpustakaan/1.0 (${contact})` : "KatalogPerpustakaan/1.0";
}

function isPlaceholder(buffer) {
  if (buffer.length < 26 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return false;

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];

  if (GRAYSCALE_PNG.has(colorType)) return true;

  return PLACEHOLDER_PNG.some(([w, h]) => width === w && height === h);
}

async function grab(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "image/*", "User-Agent": userAgent() },
  });

  if (!response.ok) return null;

  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < MIN_BYTES || buffer.length > MAX_BYTES) return null;
  if (isPlaceholder(buffer)) return null;

  return { buffer, type };
}

const SOURCES = [
  (isbn) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
  (isbn) => `https://books.google.com/books/content?vid=ISBN${isbn}&printsec=frontcover&img=1&zoom=2`,
];

export default async function handler(request, response) {
  const isbn = toIsbn13(new URL(request.url, "http://localhost").searchParams.get("isbn") ?? "");

  if (!isbn) {
    response.setHeader("Cache-Control", "no-store");
    response.status(400).end();
    return;
  }

  for (const source of SOURCES) {
    try {
      const image = await grab(source(isbn));

      if (image) {
        response.setHeader("Content-Type", image.type);
        response.setHeader("Cache-Control", CACHE_HIT);
        response.status(200).end(image.buffer);
        return;
      }
    } catch {}
  }

  response.setHeader("Cache-Control", CACHE_MISS);
  response.status(404).end();
}
