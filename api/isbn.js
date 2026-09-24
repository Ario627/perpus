import { mapGoogleVolume, mapOpenLibraryEntry, SOURCE } from "../isbn-map.js";
import { toIsbn13 } from "../isbn-validate.js";

const TIMEOUT_MS = 8000;
const MAX_AGE_FOUND = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";
const MAX_AGE_MISS = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600";

function userAgent() {
  const contact = process.env.OPEN_LIBRARY_CONTACT?.trim();
  return contact ? `KatalogPerpustakaan/1.0 (${contact})` : "KatalogPerpustakaan/1.0";
}

async function getJson(url, headers) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json", "User-Agent": userAgent(), ...headers },
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function fromGoogle(isbn) {
  const key = process.env.GOOGLE_BOOKS_API_KEY?.trim();
  if (!key) return null;

  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", `isbn:${isbn}`);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("printType", "books");
  url.searchParams.set("key", key);

  const volume = (await getJson(url))?.items?.[0]?.volumeInfo;
  return volume ? mapGoogleVolume(volume, isbn) : null;
}

async function fromOpenLibrary(isbn) {
  const url = new URL("https://openlibrary.org/api/books");
  url.searchParams.set("bibkeys", `ISBN:${isbn}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("jscmd", "data");

  const entry = (await getJson(url))?.[`ISBN:${isbn}`];
  return entry ? mapOpenLibraryEntry(entry, isbn) : null;
}

function classify(error) {
  if (error?.name === "TimeoutError") return "timeout";
  if (typeof error?.status !== "number") return "offline";
  if (error.status === 429 || error.status === 403) return "quota";
  if (error.status === 400) return "key";
  return "server";
}

async function resolve(isbn) {
  const attempts = [
    [SOURCE.GOOGLE_BOOKS, () => fromGoogle(isbn)],
    [SOURCE.OPEN_LIBRARY, () => fromOpenLibrary(isbn)],
  ];

  let answered = false;
  let failure = "";

  for (const [source, attempt] of attempts) {
    try {
      const book = await attempt();
      if (book) return { status: "found", isbn, source, book };
      answered = true;
    } catch (error) {
      failure = classify(error);
    }
  }

  if (answered) return { status: "not-found", isbn, degraded: Boolean(failure), reason: failure };
  return { status: "error", isbn, reason: failure || "offline" };
}

export default async function handler(request, response) {
  const isbn = toIsbn13(new URL(request.url, "http://localhost").searchParams.get("isbn") ?? "");

  if (!isbn) {
    response.setHeader("Cache-Control", "no-store");
    response.status(400).json({ status: "invalid", isbn: "" });
    return;
  }

  let result;

  try {
    result = await resolve(isbn);
  } catch {
    result = { status: "error", isbn, reason: "offline" };
  }

  response.setHeader("Cache-Control", result.status === "found" ? MAX_AGE_FOUND : MAX_AGE_MISS);
  response.status(200).json(result);
}
