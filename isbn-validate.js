const WEIGHTS_13 = [1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3];
const WEIGHTS_10 = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const ISBN13_PREFIXES = new Set(["978", "979"]);
const ISBN13_SHAPE = /^\d{13}$/;
const ISBN10_SHAPE = /^\d{9}[\dX]$/;

export function normalizeIsbn(value) {
  return String(value ?? "").toUpperCase().replace(/[^0-9X]/g, "");
}

function toDigits(isbn) {
  return Array.from(isbn, (char) => (char === "X" ? 10 : char.charCodeAt(0) - 48));
}

function weightedSum(digits, weights) {
  return digits.reduce((total, digit, index) => total + digit * weights[index], 0);
}

function isbn13CheckDigit(body) {
  return (10 - (weightedSum(toDigits(body), WEIGHTS_13) % 10)) % 10;
}

export function isValidIsbn13(value) {
  const isbn = normalizeIsbn(value);
  if (!ISBN13_SHAPE.test(isbn) || !ISBN13_PREFIXES.has(isbn.slice(0, 3))) return false;
  return isbn13CheckDigit(isbn.slice(0, 12)) === toDigits(isbn)[12];
}

export function isValidIsbn10(value) {
  const isbn = normalizeIsbn(value);
  if (!ISBN10_SHAPE.test(isbn)) return false;
  return weightedSum(toDigits(isbn), WEIGHTS_10) % 11 === 0;
}

export function toIsbn13(value) {
  const isbn = normalizeIsbn(value);
  if (isValidIsbn13(isbn)) return isbn;
  if (!isValidIsbn10(isbn)) return null;

  const body = `978${isbn.slice(0, 9)}`;
  return `${body}${isbn13CheckDigit(body)}`;
}

export function inspectIsbn(value) {
  const normalized = normalizeIsbn(value);
  const isbn13 = toIsbn13(normalized);

  if (!isbn13) return { valid: false, normalized, format: "", isbn13: "" };

  return {
    valid: true,
    normalized,
    format: normalized.length === 10 ? "isbn10" : "isbn13",
    isbn13,
  };
}