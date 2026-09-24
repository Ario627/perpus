import { mapGoogleVolume, mapOpenLibraryEntry, SOURCE } from "./isbn-map.js";
import { toIsbn13 } from "./isbn-validate.js";

const PROXY_PATH = "/api/isbn";
const PROXY_TIMEOUT_MS = 15000;
const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_HOST_GAP_MS = 150;
const HOST_GAP_MS = { "openlibrary.org": 1000 };

const hostChains = new Map();
const hostLastAt = new Map();

const noop = () => {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function paced(host, task) {
  const gap = HOST_GAP_MS[host] ?? DEFAULT_HOST_GAP_MS;
  const chain = (hostChains.get(host) ?? Promise.resolve()).then(async () => {
    const wait = (hostLastAt.get(host) ?? 0) + gap - Date.now();
    if (wait > 0) await sleep(wait);

    try {
      return await task();
    } finally {
      hostLastAt.set(host, Date.now());
    }
  });

  hostChains.set(host, chain.then(noop, noop));
  return chain;
}

function timeoutSignal(ms, signal) {
  const signals = [AbortSignal.timeout(ms)];
  if (signal) signals.push(signal);
  return AbortSignal.any(signals);
}

async function requestJson(url, signal) {
  const host = new URL(url).host;

  return paced(host, async () => {
    const response = await fetch(url, {
      signal: timeoutSignal(REQUEST_TIMEOUT_MS, signal),
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.name = "HttpError";
      error.status = response.status;
      throw error;
    }

    return response.json();
  });
}

async function lookupGoogleBooks(isbn, signal) {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", `isbn:${isbn}`);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("printType", "books");

  const volume = (await requestJson(url, signal))?.items?.[0]?.volumeInfo;
  return volume ? mapGoogleVolume(volume, isbn) : null;
}

async function lookupOpenLibrary(isbn, signal) {
  const url = new URL("https://openlibrary.org/api/books");
  url.searchParams.set("bibkeys", `ISBN:${isbn}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("jscmd", "data");

  const entry = (await requestJson(url, signal))?.[`ISBN:${isbn}`];
  return entry ? mapOpenLibraryEntry(entry, isbn) : null;
}

function classifyFailure(error) {
  if (error?.name === "TimeoutError") return "timeout";
  if (error?.name !== "HttpError") return "offline";
  if (error.status === 429 || error.status === 403) return "quota";
  if (error.status === 400) return "key";
  return "server";
}

async function viaProxy(isbn, signal) {
  const response = await fetch(`${PROXY_PATH}?isbn=${isbn}`, {
    signal: timeoutSignal(PROXY_TIMEOUT_MS, signal),
    headers: { Accept: "application/json" },
  });

  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) {
    throw new Error("proxy tidak tersedia");
  }

  const result = await response.json();
  if (!result || typeof result.status !== "string") throw new Error("respons proxy tidak dikenali");

  return result;
}

async function directLookup(isbn, signal) {
  const attempts = [
    [SOURCE.GOOGLE_BOOKS, () => lookupGoogleBooks(isbn, signal)],
    [SOURCE.OPEN_LIBRARY, () => lookupOpenLibrary(isbn, signal)],
  ];

  let answered = false;
  let failure = "";

  for (const [source, attempt] of attempts) {
    try {
      const book = await attempt();
      if (book) return { status: "found", isbn, source, book };
      answered = true;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return { status: "cancelled", isbn };
      failure = classifyFailure(error);
    }
  }

  if (answered) return { status: "not-found", isbn, degraded: Boolean(failure), reason: failure };
  return { status: "error", isbn, reason: failure || "offline" };
}

export async function lookupIsbn(value, { signal } = {}) {
  const isbn = toIsbn13(value);
  if (!isbn) return { status: "invalid", isbn: "" };

  try {
    return await viaProxy(isbn, signal);
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return { status: "cancelled", isbn };
  }

  return directLookup(isbn, signal);
}