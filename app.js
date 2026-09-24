import { preferredCamera, writeSettings } from "./config.js";
import { lookupIsbn } from "./isbn-api.js";
import { SOURCE_LABELS } from "./isbn-map.js";
import { inspectIsbn, normalizeIsbn } from "./isbn-validate.js";
import { createIsbnScanner, SCANNER_STATE } from "./scanner.js";

const STORAGE_KEY = "perpus_books_v1";
const DEFAULT_LOCATION = "Perpustakaan Sekolah";
const TOAST_MS = 2800;
const SPINE_TONES = 6;
const LIVE_STATUS = "Arahkan kamera ke barcode di belakang buku";

const collator = new Intl.Collator("id", { numeric: true, sensitivity: "base" });
const mobileQuery = window.matchMedia("(max-width: 63.999rem)");

const BLOCKED_COPY = {
  permission: {
    title: "Izin kamera ditolak",
    text: "Izinkan akses kamera lewat pengaturan situs di browser, lalu coba lagi.",
    locked: "Izin kamera diblokir untuk alamat ini. Buka ikon gembok di bilah alamat, ubah izin kamera menjadi Izinkan, lalu muat ulang halaman.",
  },
  "no-camera": {
    title: "Kamera tidak ditemukan",
    text: "Perangkat ini tidak punya kamera yang bisa dipakai. Unggah foto barcode atau ketik ISBN manual.",
  },
  busy: {
    title: "Kamera sedang dipakai",
    text: "Tutup aplikasi lain yang sedang memakai kamera, lalu coba lagi.",
  },
  "insecure-context": {
    title: "Koneksi tidak aman",
    text: "Kamera hanya bisa dipakai lewat HTTPS atau localhost. Unggah foto barcode sebagai gantinya.",
  },
  unsupported: {
    title: "Browser tidak mendukung kamera",
    text: "Perbarui browser ke versi terbaru, atau unggah foto barcode.",
  },
  library: {
    title: "Pemindai gagal dimuat",
    text: "Pustaka pemindai tidak berhasil dimuat. Periksa koneksi internet lalu muat ulang halaman.",
  },
  unknown: {
    title: "Kamera gagal dibuka",
    text: "Coba lagi sebentar lagi, atau unggah foto barcode.",
  },
};

const RETRYABLE = new Set(["permission", "no-camera", "busy", "unknown"]);

const dom = {
  form: document.querySelector("#bookForm"),
  formHeading: document.querySelector("#formHeading"),
  formHint: document.querySelector("#formHint"),
  submitLabel: document.querySelector("#submitLabel"),
  cancelEdit: document.querySelector("#cancelEdit"),
  sheetClose: document.querySelector("#sheetClose"),
  sheetScrim: document.querySelector("#sheetScrim"),
  formSheet: document.querySelector("#formSheet"),
  actionBar: document.querySelector("#actionBar"),
  actionScan: document.querySelector("#actionScan"),
  actionManual: document.querySelector("#actionManual"),
  title: document.querySelector("#title"),
  titleError: document.querySelector("#titleError"),
  author: document.querySelector("#author"),
  category: document.querySelector("#category"),
  shelf: document.querySelector("#shelf"),
  isbn: document.querySelector("#isbn"),
  dupNotice: document.querySelector("#dupNotice"),
  lookupStatus: document.querySelector("#lookupStatus"),
  scanButton: document.querySelector("#scanButton"),
  lookupButton: document.querySelector("#lookupButton"),
  sourceBadge: document.querySelector("#sourceBadge"),
  sourceBadgeText: document.querySelector("#sourceBadgeText"),
  clearLookup: document.querySelector("#clearLookup"),
  categoryHint: document.querySelector("#categoryHint"),
  categoryHintText: document.querySelector("#categoryHintText"),
  categoryHintApply: document.querySelector("#categoryHintApply"),
  coverPreview: document.querySelector("#coverPreview"),
  coverImage: document.querySelector("#coverImage"),
  coverRemove: document.querySelector("#coverRemove"),
  total: document.querySelector("#total"),
  cats: document.querySelector("#cats"),
  shelves: document.querySelector("#shelves"),
  search: document.querySelector("#search"),
  filterRow: document.querySelector("#filterRow"),
  filterCategory: document.querySelector("#filterCategory"),
  filterShelf: document.querySelector("#filterShelf"),
  resultCount: document.querySelector("#resultCount"),
  list: document.querySelector("#bookList"),
  rowTemplate: document.querySelector("#bookRowTemplate"),
  emptyState: document.querySelector("#emptyState"),
  noResult: document.querySelector("#noResult"),
  clearFilters: document.querySelector("#clearFilters"),
  exportButton: document.querySelector("#exportButton"),
  importInput: document.querySelector("#importInput"),
  toast: document.querySelector("#toast"),
  scanDialog: document.querySelector("#scanDialog"),
  scanStage: document.querySelector("#scanStage"),
  scanStatus: document.querySelector("#scanStatus"),
  scanFile: document.querySelector("#scanFile"),
  cameraBar: document.querySelector("#cameraBar"),
  cameraSelect: document.querySelector("#cameraSelect"),
  torchButton: document.querySelector("#torchButton"),
  bootTitle: document.querySelector("#bootTitle"),
  bootText: document.querySelector("#bootText"),
  blockedTitle: document.querySelector("#blockedTitle"),
  blockedText: document.querySelector("#blockedText"),
  blockedRetry: document.querySelector("#blockedRetry"),
  flashIsbn: document.querySelector("#flashIsbn"),
  busyIsbn: document.querySelector("#busyIsbn"),
  noticeTitle: document.querySelector("#noticeTitle"),
  noticeText: document.querySelector("#noticeText"),
  scanPanels: [...document.querySelectorAll(".scan-panel")],
};

const state = {
  books: readStoredBooks(),
  query: "",
  category: "",
  shelf: "",
  editingId: null,
  armedDeleteId: null,
  sheetOpen: false,
  coverUrl: "",
  suggestedCategory: "",
  categoryTouched: false,
  lookupSource: "",
};

let toastTimer = 0;
let mismatchTimer = 0;
let lookupToken = 0;

function readStoredBooks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeBook).filter(Boolean);
  } catch {
    return [];
  }
}

function persistBooks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.books));
    return true;
  } catch {
    return false;
  }
}

function saveChanges(message, tone = "neutral") {
  const saved = persistBooks();
  notify(saved ? message : "Penyimpanan browser penuh, perubahan tidak tersimpan.", saved ? tone : "danger");
}

function notify(message, tone = "neutral") {
  dom.toast.textContent = message;
  dom.toast.dataset.tone = tone;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, TOAST_MS);
}

function newBookId() {
  return `b_${crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`}`;
}

function safeUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function sanitizeBook(raw) {
  if (!raw || typeof raw !== "object") return null;

  const title = text(raw.title);
  if (!title) return null;

  const now = new Date().toISOString();

  return {
    id: text(raw.id, newBookId()),
    title,
    author: text(raw.author),
    category: text(raw.category),
    shelf: text(raw.shelf),
    isbn: normalizeIsbn(raw.isbn),
    location: text(raw.location, DEFAULT_LOCATION),
    coverUrl: safeUrl(raw.coverUrl),
    dataSource: text(raw.dataSource, "manual"),
    createdAt: text(raw.createdAt, now),
    updatedAt: text(raw.updatedAt, now),
  };
}

function truncate(value, max = 34) {
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
}

function spineTone(seed) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)) % 100000;
  return hash % SPINE_TONES;
}

const PLACEHOLDER_SIZES = [[128, 170], [256, 340]];

function openLibraryCover(isbn) {
  return isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : "";
}

function apiCover(isbn) {
  return isbn ? `/api/cover?isbn=${isbn}` : "";
}

function coverCandidates(book) {
  return [book.coverUrl, apiCover(book.isbn), openLibraryCover(book.isbn)].filter(Boolean);
}

function googleBooksUrl(isbn) {
  return isbn ? `https://books.google.com/books?vid=ISBN${isbn}` : "";
}

function isPlaceholder(image) {
  return PLACEHOLDER_SIZES.some(([width, height]) => image.naturalWidth === width && image.naturalHeight === height);
}

function loadCover(image, candidates, { onReady, onEmpty }) {
  let index = 0;

  const next = () => {
    if (index >= candidates.length) {
      image.removeAttribute("src");
      image.hidden = true;
      onEmpty();
      return;
    }

    const url = candidates[index];
    index += 1;
    let settled = false;

    const settle = (usable) => {
      if (settled) return;
      settled = true;

      if (usable) {
        image.hidden = false;
        onReady();
        return;
      }

      next();
    };

    const accept = () => settle(image.naturalWidth > 0 && !isPlaceholder(image));

    image.onload = accept;
    image.onerror = () => settle(false);
    image.src = url;

    if (image.complete) accept();
  };

  next();
}

function setSheet(open) {
  state.sheetOpen = open;
  dom.formSheet.toggleAttribute("data-open", open);
  dom.sheetScrim.hidden = !(open && mobileQuery.matches);
  dom.actionBar.hidden = open;
  document.body.toggleAttribute("data-sheet-open", open);
  syncSheetAccess();
  if (open && mobileQuery.matches) dom.title.focus({ preventScroll: true });
}

function syncSheetAccess() {
  dom.formSheet.inert = mobileQuery.matches && !state.sheetOpen;
}

function renderCoverPreview() {
  const isbn = normalizeIsbn(dom.isbn.value);
  const derived = isbn && inspectIsbn(isbn).valid ? [apiCover(isbn), openLibraryCover(isbn)] : [];
  const candidates = [state.coverUrl, ...derived].filter(Boolean);

  if (candidates.length === 0) {
    dom.coverPreview.hidden = true;
    dom.coverImage.removeAttribute("src");
    return;
  }

  loadCover(dom.coverImage, candidates, {
    onReady: () => {
      dom.coverPreview.hidden = false;
    },
    onEmpty: () => {
      dom.coverPreview.hidden = true;
    },
  });
}

function renderLookupExtras() {
  const label = SOURCE_LABELS[state.lookupSource] ?? "";
  dom.sourceBadge.hidden = !label;
  if (label) dom.sourceBadgeText.textContent = `Data dari ${label}`;

  const showHint = Boolean(state.suggestedCategory) && !state.categoryTouched && dom.category.value !== state.suggestedCategory;
  dom.categoryHint.hidden = !showHint;
  if (showHint) dom.categoryHintText.textContent = `Saran kategori: ${state.suggestedCategory}`;
}

function renderDuplicateNotice() {
  const isbn = normalizeIsbn(dom.isbn.value);
  const matches = isbn ? state.books.filter((book) => book.isbn === isbn && book.id !== state.editingId) : [];

  dom.dupNotice.hidden = matches.length === 0;
  if (matches.length > 0) {
    dom.dupNotice.textContent = `ISBN ini sudah dipakai ${matches.length} buku lain di katalog. Menyimpan akan menambah eksemplar baru.`;
  }
}

function readForm() {
  return {
    title: dom.title.value.trim(),
    author: dom.author.value.trim(),
    category: dom.category.value,
    shelf: dom.shelf.value.trim(),
    isbn: normalizeIsbn(dom.isbn.value),
  };
}

function clearTitleError() {
  dom.titleError.hidden = true;
  dom.title.removeAttribute("aria-invalid");
}

function showTitleError(message) {
  dom.titleError.textContent = message;
  dom.titleError.hidden = false;
  dom.title.setAttribute("aria-invalid", "true");
  dom.title.focus();
}

function resetForm() {
  dom.form.reset();
  clearTitleError();

  state.coverUrl = "";
  state.suggestedCategory = "";
  state.categoryTouched = false;
  state.lookupSource = "";

  renderLookupExtras();
  renderCoverPreview();
  renderDuplicateNotice();
}

function stopEditing() {
  state.editingId = null;
  resetForm();

  dom.formHeading.textContent = "Tambah Buku";
  dom.formHint.textContent = "Pindai ISBN untuk mengisi otomatis, atau isi manual.";
  dom.submitLabel.textContent = "Simpan Buku";
  dom.cancelEdit.hidden = true;
}

function startEditing(id) {
  const book = state.books.find((item) => item.id === id);
  if (!book) return;

  state.editingId = id;
  state.armedDeleteId = null;
  state.coverUrl = book.coverUrl;
  state.suggestedCategory = "";
  state.categoryTouched = true;
  state.lookupSource = book.dataSource === "manual" ? "" : book.dataSource;

  dom.title.value = book.title;
  dom.author.value = book.author;
  dom.category.value = book.category;
  dom.shelf.value = book.shelf;
  dom.isbn.value = book.isbn;

  clearTitleError();
  renderLookupExtras();
  renderCoverPreview();
  renderDuplicateNotice();
  renderList();

  dom.formHeading.textContent = "Ubah Buku";
  dom.formHint.textContent = "Perbarui data buku, lalu simpan perubahan.";
  dom.submitLabel.textContent = "Simpan Perubahan";
  dom.cancelEdit.hidden = false;

  setSheet(true);
}

function handleSubmit(event) {
  event.preventDefault();

  const input = readForm();
  if (!input.title) {
    showTitleError("Judul buku wajib diisi.");
    return;
  }

  const editing = Boolean(state.editingId);
  const now = new Date().toISOString();
  const extras = { coverUrl: state.coverUrl, dataSource: state.lookupSource || "manual" };

  if (editing) {
    const book = state.books.find((item) => item.id === state.editingId);
    if (book) Object.assign(book, input, extras, { updatedAt: now });
  } else {
    state.books.unshift({
      id: newBookId(),
      ...input,
      ...extras,
      location: DEFAULT_LOCATION,
      createdAt: now,
      updatedAt: now,
    });
  }

  stopEditing();
  renderAll();
  saveChanges(editing ? "Perubahan buku disimpan." : "Buku baru ditambahkan ke katalog.");
  if (mobileQuery.matches) setSheet(false);
}

function armDelete(id) {
  state.armedDeleteId = id;
  renderList();
}

function disarmDelete() {
  state.armedDeleteId = null;
  renderList();
}

function deleteBook(id) {
  const book = state.books.find((item) => item.id === id);
  state.books = state.books.filter((item) => item.id !== id);
  state.armedDeleteId = null;
  if (state.editingId === id) stopEditing();

  renderAll();
  saveChanges(book ? `${truncate(book.title)} dihapus dari katalog.` : "Buku dihapus dari katalog.", "danger");
}

function uniqueValues(field) {
  const values = new Set();
  for (const book of state.books) if (book[field]) values.add(book[field]);
  return [...values].sort(collator.compare);
}

function renderStats() {
  dom.total.textContent = state.books.length.toLocaleString("id-ID");
  dom.cats.textContent = uniqueValues("category").length.toLocaleString("id-ID");
  dom.shelves.textContent = uniqueValues("shelf").length.toLocaleString("id-ID");
}

function fillSelect(select, values, placeholder) {
  const previous = select.value;
  select.replaceChildren(new Option(placeholder, ""), ...values.map((value) => new Option(value, value)));
  select.value = values.includes(previous) ? previous : "";
  select.disabled = values.length === 0;
}

function renderFilters() {
  fillSelect(dom.filterCategory, uniqueValues("category"), "Semua kategori");
  fillSelect(dom.filterShelf, uniqueValues("shelf"), "Semua rak");
  dom.filterRow.hidden = state.books.length === 0;
  state.category = dom.filterCategory.value;
  state.shelf = dom.filterShelf.value;
}

function visibleBooks() {
  const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);

  return state.books
    .filter((book) => {
      if (state.category && book.category !== state.category) return false;
      if (state.shelf && book.shelf !== state.shelf) return false;
      if (terms.length === 0) return true;

      const haystack = `${book.title} ${book.author} ${book.isbn}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function createRow(book) {
  const row = dom.rowTemplate.content.firstElementChild.cloneNode(true);
  const slot = (name) => row.querySelector(`[data-slot="${name}"]`);

  row.dataset.id = book.id;
  if (book.id === state.editingId) row.dataset.editing = "";

  slot("title").textContent = book.title;

  const meta = [book.author, book.shelf && `Rak ${book.shelf}`].filter(Boolean).join(" · ");
  slot("meta").textContent = meta;
  slot("meta").hidden = meta.length === 0;

  slot("category").textContent = book.category;
  slot("category").hidden = !book.category;

  slot("isbn").textContent = book.isbn ? `ISBN ${book.isbn}` : "";
  slot("isbn").hidden = !book.isbn;

  const spine = slot("spine");
  const initial = slot("initial");
  const cover = slot("cover");

  spine.dataset.tone = String(spineTone(book.title));
  initial.textContent = [...book.title][0]?.toUpperCase() ?? "?";

  const link = googleBooksUrl(book.isbn);
  if (link) {
    spine.href = link;
    spine.target = "_blank";
    spine.rel = "noopener noreferrer";
    spine.setAttribute("aria-label", `Buka data ${book.title} di Google Books`);
  } else {
    spine.removeAttribute("href");
    spine.setAttribute("aria-hidden", "true");
  }

  loadCover(cover, coverCandidates(book), {
    onReady: () => {
      initial.hidden = true;
    },
    onEmpty: () => {
      initial.hidden = false;
    },
  });

  const armed = book.id === state.armedDeleteId;
  slot("actions").hidden = armed;
  slot("confirm").hidden = !armed;

  row.querySelector('[data-action="edit"]').setAttribute("aria-label", `Ubah data ${book.title}`);
  row.querySelector('[data-action="delete"]').setAttribute("aria-label", `Hapus ${book.title}`);

  return row;
}

function renderList() {
  const books = visibleBooks();

  dom.list.replaceChildren(...books.map(createRow));
  dom.list.hidden = books.length === 0;
  dom.emptyState.hidden = state.books.length > 0;
  dom.noResult.hidden = state.books.length === 0 || books.length > 0;

  if (state.books.length === 0) {
    dom.resultCount.textContent = "";
    return;
  }

  const shown = books.length.toLocaleString("id-ID");
  const total = state.books.length.toLocaleString("id-ID");
  dom.resultCount.textContent = books.length === state.books.length ? `${total} buku` : `${shown} dari ${total} buku`;
}

function renderAll() {
  renderStats();
  renderFilters();
  renderList();
  renderDuplicateNotice();
}

function resetFilters() {
  state.query = "";
  state.category = "";
  state.shelf = "";
  dom.search.value = "";
  dom.filterCategory.value = "";
  dom.filterShelf.value = "";
  renderAll();
  dom.search.focus();
}

function handleListClick(event) {
  const button = event.target.closest("[data-action]");
  const row = button?.closest("[data-id]");
  if (!row) return;

  const id = row.dataset.id;
  const handlers = {
    edit: () => startEditing(id),
    delete: () => armDelete(id),
    "confirm-delete": () => deleteBook(id),
    "cancel-delete": disarmDelete,
  };

  handlers[button.dataset.action]?.();
}

function mergeBooks(incoming) {
  const byId = new Map(state.books.map((book) => [book.id, book]));
  let added = 0;
  let updated = 0;

  for (const book of incoming) {
    if (byId.has(book.id)) updated += 1;
    else added += 1;
    byId.set(book.id, book);
  }

  state.books = [...byId.values()];
  return { added, updated };
}

function exportBooks() {
  if (state.books.length === 0) {
    notify("Belum ada data untuk diekspor.", "danger");
    return;
  }

  const payload = {
    app: "perpus-katalog",
    version: 1,
    exportedAt: new Date().toISOString(),
    books: state.books,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `katalog-perpustakaan-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(`${state.books.length} buku diekspor ke berkas JSON.`);
}

async function handleImport(event) {
  const [file] = event.target.files ?? [];
  event.target.value = "";
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    const source = Array.isArray(parsed) ? parsed : parsed?.books;
    if (!Array.isArray(source)) throw new Error("format");

    const books = source.map(sanitizeBook).filter(Boolean);
    if (books.length === 0) {
      notify("Berkas tidak berisi data buku yang bisa dibaca.", "danger");
      return;
    }

    const { added, updated } = mergeBooks(books);
    renderAll();
    saveChanges(`${added} buku ditambahkan, ${updated} diperbarui dari impor.`);
  } catch {
    notify("Berkas JSON tidak bisa dibaca. Gunakan berkas hasil ekspor aplikasi ini.", "danger");
  }
}

function setScanView(view, { status = "", title = "", text = "", tone = "neutral", isbn = "", retry = true } = {}) {
  dom.scanStatus.textContent = status;
  dom.scanStage.dataset.tone = tone;

  for (const panel of dom.scanPanels) panel.hidden = panel.dataset.panel !== view;

  switch (view) {
    case "boot":
      dom.bootTitle.textContent = title;
      dom.bootText.textContent = text;
      break;
    case "blocked":
      dom.blockedTitle.textContent = title;
      dom.blockedText.textContent = text;
      dom.blockedRetry.hidden = !retry;
      break;
    case "flash":
      dom.flashIsbn.textContent = isbn;
      break;
    case "busy":
      dom.busyIsbn.textContent = isbn;
      break;
    case "notice":
      dom.noticeTitle.textContent = title;
      dom.noticeText.textContent = text;
      break;
    default:
      break;
  }
}

function setInlineLookup(view, { tone = "neutral", title = "", text = "" } = {}) {
  const views = {
    busy: { tone: "neutral", busy: true, body: text },
    notice: { tone, busy: false, body: title ? `${title}. ${text}` : text },
    done: { tone: "ok", busy: false, body: text },
    idle: { tone: "neutral", busy: false, body: "" },
  };

  const message = views[view] ?? views.idle;

  dom.lookupStatus.hidden = !message.body;
  dom.lookupStatus.textContent = message.body;
  dom.lookupStatus.dataset.tone = message.tone;
  dom.lookupStatus.toggleAttribute("data-busy", message.busy);
}

function renderCameras(devices, { activeId = "", torch = false } = {}) {
  const multiple = devices.length > 1;

  dom.cameraBar.hidden = !multiple && !torch;
  dom.cameraSelect.hidden = !multiple;
  dom.torchButton.hidden = !torch;

  if (multiple) {
    dom.cameraSelect.replaceChildren(...devices.map((device) => new Option(device.label, device.id)));
    if (activeId) dom.cameraSelect.value = activeId;
  }
}

const scanner = createIsbnScanner({
  onStateChange: handleScannerState,
  onDetected: ({ isbn }) => runLookup(isbn),
  onMismatch: handleScannerMismatch,
  onDevices: renderCameras,
  readCamera: preferredCamera,
  writeCamera: (id) => {
    if (preferredCamera() !== id) writeSettings({ preferredCameraId: id });
  },
});

function handleScannerState(next, detail) {
  switch (next) {
    case SCANNER_STATE.REQUESTING:
      setScanView("boot", {
        status: detail.via === "file" ? "Membaca berkas gambar" : "Menyiapkan kamera",
        title: detail.via === "file" ? "Membaca gambar" : "Menyiapkan kamera",
        text: detail.via === "file" ? "Mencari barcode ISBN di dalam gambar." : "Setujui permintaan izin kamera dari browser.",
      });
      break;
    case SCANNER_STATE.SCANNING:
      setScanView("live", { status: LIVE_STATUS });
      break;
    case SCANNER_STATE.PAUSED:
      setScanView("boot", {
        status: "Kamera dijeda",
        title: "Kamera dijeda",
        text: "Pemindaian dilanjutkan otomatis saat tab ini aktif kembali.",
      });
      break;
    case SCANNER_STATE.DETECTED:
      setScanView("flash", { status: "ISBN terbaca", isbn: detail.isbn });
      break;
    case SCANNER_STATE.BLOCKED:
      showScanBlocked(detail.reason, detail.permanent);
      break;
    case SCANNER_STATE.ERROR:
      setScanView("notice", {
        tone: "danger",
        status: "Barcode tidak terbaca",
        title: "Barcode tidak terbaca",
        text: "Coba pindai ulang dengan pencahayaan lebih terang, atau unggah foto barcode yang lebih jelas.",
      });
      break;
    default:
      break;
  }
}

function showScanBlocked(reason, permanent = false) {
  const copy = BLOCKED_COPY[reason] ?? BLOCKED_COPY.unknown;

  setScanView("blocked", {
    status: copy.title,
    title: copy.title,
    text: permanent && copy.locked ? copy.locked : copy.text,
    retry: RETRYABLE.has(reason) && !permanent,
  });
}

function handleScannerMismatch({ raw }) {
  dom.scanStage.dataset.tone = "warn";
  dom.scanStatus.textContent = raw ? `${raw} bukan ISBN yang valid, coba pindai ulang` : "Barcode tidak dikenali, coba pindai ulang";

  clearTimeout(mismatchTimer);
  mismatchTimer = setTimeout(() => {
    dom.scanStage.dataset.tone = "neutral";
    if (scanner.getState() === SCANNER_STATE.SCANNING) dom.scanStatus.textContent = LIVE_STATUS;
  }, 1800);
}

function openScanDialog() {
  if (dom.scanDialog.open) return;

  dom.scanStage.dataset.tone = "neutral";
  dom.cameraBar.hidden = true;
  dom.torchButton.setAttribute("aria-pressed", "false");
  dom.torchButton.textContent = "Lampu";
  setScanView("boot", { status: "Menyiapkan kamera", title: "Menyiapkan kamera", text: "Setujui permintaan izin kamera dari browser." });

  dom.scanDialog.showModal();
  scanner.start();
}

function closeScanDialog() {
  lookupToken += 1;
  scanner.stop();
  if (dom.scanDialog.open) dom.scanDialog.close();
}

function openManualEntry() {
  closeScanDialog();
  setSheet(true);
  dom.isbn.focus({ preventScroll: true });
}

async function runLookup(rawValue, { inline = false } = {}) {
  const reading = inspectIsbn(rawValue);
  const token = ++lookupToken;
  const show = inline ? setInlineLookup : setScanView;

  if (!reading.valid) {
    show("notice", {
      tone: "danger",
      status: "ISBN tidak valid",
      title: "ISBN tidak lolos pemeriksaan",
      text: "Nomor yang terbaca tidak sesuai format ISBN. Pindai ulang, atau ketik nomornya secara manual.",
    });
    return;
  }

  show("busy", {
    status: "Mencari data buku",
    isbn: reading.isbn13,
    text: `Mencari ISBN ${reading.isbn13} di Google Books lalu Open Library.`,
  });

  const result = await lookupIsbn(reading.isbn13);
  if (token !== lookupToken) return;

  if (result.status === "found") {
    const label = SOURCE_LABELS[result.source] ?? "sumber online";
    const kept = Boolean(dom.title.value.trim());

    applyLookup(result);

    if (inline) {
      setInlineLookup("done", { text: `Data dari ${label} mengisi kolom yang masih kosong.` });
    } else {
      closeScanDialog();
      setSheet(true);
    }

    notify(kept ? `Kolom yang sudah terisi tidak ditimpa. Data ${label} hanya melengkapi bagian kosong.` : `Data buku diambil dari ${label}.`);
    return;
  }

  if (result.status === "not-found") {
    show("notice", {
      tone: "warn",
      status: "Buku tidak ditemukan",
      title: "Belum terdaftar online",
      text: result.degraded
        ? `ISBN ${result.isbn} tidak ditemukan di sumber yang bisa diakses saat ini. Sebagian sumber tidak merespons, coba lagi nanti.`
        : `ISBN ${result.isbn} tidak ada di Google Books maupun Open Library. Buku terbitan lokal umumnya belum terdaftar, lengkapi datanya manual.`,
    });
    return;
  }

  if (result.status === "cancelled") return;

  show("notice", {
    tone: "danger",
    status: "Koneksi gagal",
    title: "Gagal menghubungi layanan pencarian",
    text: result.reason === "key"
      ? "Kunci Google Books ditolak. Periksa kembali kunci di Pengaturan pencarian, atau kosongkan agar pencarian memakai kuota anonim."
      : "Permintaan ke layanan pencarian buku tidak berhasil. Periksa koneksi internet lalu coba lagi, atau lengkapi data manual.",
  });
}

function applyLookup(result) {
  const { book, source } = result;

  dom.isbn.value = book.isbn;
  if (!dom.title.value.trim()) dom.title.value = book.title;
  if (!dom.author.value.trim()) dom.author.value = book.author;

  state.coverUrl = state.coverUrl || book.coverUrl;
  state.suggestedCategory = book.suggestedCategory;
  state.categoryTouched = false;
  state.lookupSource = source;

  clearTitleError();
  renderLookupExtras();
  renderCoverPreview();
  renderDuplicateNotice();
}

function clearLookup() {
  state.coverUrl = "";
  state.suggestedCategory = "";
  state.categoryTouched = false;
  state.lookupSource = "";

  dom.isbn.value = "";
  dom.title.value = "";
  dom.author.value = "";
  dom.category.value = "";

  clearTitleError();
  renderLookupExtras();
  renderCoverPreview();
  renderDuplicateNotice();
  dom.isbn.focus();
}

dom.form.addEventListener("submit", handleSubmit);
dom.title.addEventListener("input", clearTitleError);
dom.isbn.addEventListener("input", renderDuplicateNotice);
dom.isbn.addEventListener("blur", renderCoverPreview);
dom.category.addEventListener("change", () => {
  state.categoryTouched = true;
  renderLookupExtras();
});
dom.search.addEventListener("input", () => {
  state.query = dom.search.value;
  renderList();
});
dom.filterCategory.addEventListener("change", () => {
  state.category = dom.filterCategory.value;
  renderList();
});
dom.filterShelf.addEventListener("change", () => {
  state.shelf = dom.filterShelf.value;
  renderList();
});
dom.cancelEdit.addEventListener("click", () => {
  stopEditing();
  renderList();
});
dom.clearFilters.addEventListener("click", resetFilters);
dom.list.addEventListener("click", handleListClick);
dom.actionScan.addEventListener("click", openScanDialog);
dom.actionManual.addEventListener("click", openManualEntry);
dom.sheetClose.addEventListener("click", () => setSheet(false));
dom.sheetScrim.addEventListener("click", () => setSheet(false));
dom.scanButton.addEventListener("click", openScanDialog);
dom.lookupButton.addEventListener("click", () => {
  if (!dom.isbn.value.trim()) {
    notify("Isi nomor ISBN terlebih dahulu.", "danger");
    dom.isbn.focus();
    return;
  }
  openScanDialog();
  runLookup(dom.isbn.value, { inline: true });
});
dom.categoryHintApply.addEventListener("click", () => {
  dom.category.value = state.suggestedCategory;
  state.categoryTouched = true;
  renderLookupExtras();
});
dom.clearLookup.addEventListener("click", clearLookup);
dom.coverRemove.addEventListener("click", () => {
  state.coverUrl = "";
  renderCoverPreview();
});
dom.exportButton.addEventListener("click", exportBooks);
dom.importInput.addEventListener("change", handleImport);
dom.scanFile.addEventListener("change", (event) => {
  const [file] = event.target.files ?? [];
  event.target.value = "";
  if (file) scanner.scanFile(file);
});
dom.scanDialog.addEventListener("close", () => scanner.stop());
dom.scanDialog.addEventListener("click", (event) => {
  const action = event.target.closest("[data-scan]")?.dataset.scan;
  if (action === "close") closeScanDialog();
  else if (action === "manual") openManualEntry();
  else if (action === "retry") scanner.start();
});
dom.cameraSelect.addEventListener("change", () => scanner.selectCamera(dom.cameraSelect.value));
dom.torchButton.addEventListener("click", async () => {
  const on = await scanner.toggleTorch();
  dom.torchButton.setAttribute("aria-pressed", String(on));
  dom.torchButton.textContent = on ? "Lampu mati" : "Lampu";
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || dom.scanDialog.open) return;
  if (state.sheetOpen && mobileQuery.matches) setSheet(false);
});
mobileQuery.addEventListener("change", () => {
  syncSheetAccess();
  dom.sheetScrim.hidden = !(state.sheetOpen && mobileQuery.matches);
  dom.actionBar.hidden = state.sheetOpen;
});

syncSheetAccess();
renderAll();