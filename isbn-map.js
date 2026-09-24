export const SOURCE = Object.freeze({
  GOOGLE_BOOKS: "google-books",
  OPEN_LIBRARY: "open-library",
});

export const SOURCE_LABELS = Object.freeze({
  [SOURCE.GOOGLE_BOOKS]: "Google Books",
  [SOURCE.OPEN_LIBRARY]: "Open Library",
});

const CATEGORY_RULES = [
  ["Matematika", ["mathematic", "algebra", "geometry", "calculus", "statistic", "aritmatika"]],
  ["Kesusastraan", ["fiction", "novel", "literature", "fantasy", "drama", "poetry", "comic", "sastra", "cerpen", "puisi"]],
  ["Teknologi", ["computer", "technology", "programming", "software", "engineering", "internet", "electronic", "informatika"]],
  ["Agama", ["religion", "islam", "christian", "spiritual", "quran", "bible", "buddh", "hindu"]],
  ["Sosial", ["social", "sociolog", "politic", "economic", "economy", "law", "hukum", "ekonomi"]],
  ["Bahasa & Linguistik", ["language", "linguistic", "grammar", "dictionary", "kamus", "bahasa"]],
  ["Geografi & Sejarah", ["history", "geograph", "travel", "biography", "sejarah", "geografi"]],
  ["Pendidikan", ["education", "teaching", "textbook", "curriculum", "pelajaran", "kurikulum", "pendidikan"]],
  ["Ilmu Pengetahuan", ["science", "physics", "chemistry", "biolog", "astronom", "nature"]],
];

export function suggestCategory(labels = []) {
  const haystack = labels.filter((label) => typeof label === "string").join(" ").toLowerCase();
  if (!haystack) return "";

  const match = CATEGORY_RULES.find(([, keywords]) => keywords.some((keyword) => haystack.includes(keyword)));
  return match?.[0] ?? "";
}

function httpsUrl(value) {
  return typeof value === "string" ? value.replace(/^http:\/\//, "https://") : "";
}

function composeTitle(title, subtitle) {
  const main = (title ?? "").trim();
  const extra = (subtitle ?? "").trim();
  if (!extra || main.toLowerCase().includes(extra.toLowerCase())) return main;
  return `${main}: ${extra}`;
}

export function mapGoogleVolume(volume, isbn) {
  const thumbnail = volume.imageLinks?.thumbnail ?? volume.imageLinks?.smallThumbnail ?? "";

  return {
    isbn,
    title: composeTitle(volume.title, volume.subtitle),
    author: (volume.authors ?? []).filter(Boolean).join(", "),
    coverUrl: httpsUrl(thumbnail).replace(/&zoom=\d+/, "&zoom=2"),
    suggestedCategory: suggestCategory(volume.categories ?? []),
  };
}

export function mapOpenLibraryEntry(entry, isbn) {
  const cover = entry.cover ?? {};

  return {
    isbn,
    title: composeTitle(entry.title, entry.subtitle),
    author: (entry.authors ?? []).map((author) => author?.name).filter(Boolean).join(", "),
    coverUrl: httpsUrl(cover.medium ?? cover.large ?? cover.small ?? ""),
    suggestedCategory: suggestCategory((entry.subjects ?? []).map((subject) => subject?.name)),
  };
}
