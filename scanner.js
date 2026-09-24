import { inspectIsbn, normalizeIsbn } from "./isbn-validate.js";

const ELEMENT_ID = "scanReader";
const FLASH_MS = 320;
const MISMATCH_COOLDOWN_MS = 1400;
const FRAME_RATE = 10;
const REAR_HINT = /back|rear|belakang|environment|wide/i;

export const SCANNER_STATE = Object.freeze({
  IDLE: "idle",
  REQUESTING: "requesting",
  SCANNING: "scanning",
  PAUSED: "paused",
  DETECTED: "detected",
  BLOCKED: "blocked",
  ERROR: "error",
});

export function createIsbnScanner({
  onStateChange = () => {},
  onDetected = () => {},
  onMismatch = () => {},
  onDevices = () => {},
  readCamera = () => "",
  writeCamera = () => {},
}) {
  let instance = null;
  let state = SCANNER_STATE.IDLE;
  let releaseTimer = 0;
  let mismatchAt = 0;
  let devices = [];
  let activeId = "";
  let torchOn = false;
  let lastError = null;

  function emit(next, detail = {}) {
    state = next;
    onStateChange(next, detail);
  }

  function library() {
    const api = globalThis.Html5Qrcode;
    const formats = globalThis.Html5QrcodeSupportedFormats;
    if (!api || !formats) throw new Error("html5-qrcode tidak tersedia");
    return { api, formats };
  }

  function ensureInstance() {
    if (instance) return instance;

    const { api, formats } = library();

    try {
      instance = new api(ELEMENT_ID, {
        formatsToSupport: [formats.EAN_13],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false,
      });
    } catch (cause) {
      const error = new Error("pemindai gagal dibuat");
      error.name = "ScannerInitError";
      error.cause = cause;
      throw error;
    }

    return instance;
  }

  function blocker() {
    if (!globalThis.isSecureContext) return "insecure-context";
    if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
    if (!globalThis.Html5Qrcode || !globalThis.Html5QrcodeSupportedFormats) return "library";
    if (!document.getElementById(ELEMENT_ID)) return "library";
    return "";
  }

  async function permissionState() {
    if (!navigator.permissions?.query) return "unknown";

    try {
      const status = await navigator.permissions.query({ name: "camera" });
      return status.state;
    } catch {
      return "unknown";
    }
  }

  async function enumerate() {
    const { api } = library();
    const found = await api.getCameras();

    devices = found.map((device, index) => ({
      id: device.id,
      label: device.label?.trim() || `Kamera ${index + 1}`,
    }));

    return devices;
  }

  function preferred() {
    const remembered = readCamera();
    if (remembered && devices.some((device) => device.id === remembered)) return remembered;
    return devices.find((device) => REAR_HINT.test(device.label))?.id ?? devices[0]?.id ?? "";
  }

  function canTorch() {
    if (!instance || !activeId) return false;

    try {
      return Boolean(instance.getRunningTrackCapabilities()?.torch);
    } catch {
      return false;
    }
  }

  function publish() {
    onDevices(devices, { activeId, torch: canTorch() });
  }

  async function adoptRunningCamera() {
    try {
      const settings = instance?.getRunningTrackSettings();
      if (settings?.deviceId) {
        activeId = settings.deviceId;
        writeCamera(activeId);
      }
    } catch {
      activeId = "";
    }

    try {
      await enumerate();
    } catch {
      devices = [];
    }

    publish();
  }

  function classify(error) {
    switch (error?.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "permission";
      case "NotFoundError":
      case "OverconstrainedError":
      case "DevicesNotFoundError":
        return "no-camera";
      case "NotReadableError":
      case "TrackStartError":
        return "busy";
      case "NotSupportedError":
        return "unsupported";
      case "ScannerInitError":
        return "library";
      default:
        return "unknown";
    }
  }

  function clearRelease() {
    clearTimeout(releaseTimer);
    releaseTimer = 0;
  }

  async function halt() {
    const scanner = instance;
    instance = null;
    activeId = "";
    torchOn = false;
    lastError = null;
    devices = [];

    if (scanner) {
      try {
        await scanner.stop();
      } catch {}

      try {
        scanner.clear();
      } catch {}
    }

    publish();
  }

  function accept(isbn) {
    emit(SCANNER_STATE.DETECTED, { isbn });

    halt().finally(() => {
      clearRelease();
      releaseTimer = setTimeout(() => onDetected({ isbn }), FLASH_MS);
    });
  }

  function handleDecode(decodedText) {
    if (state !== SCANNER_STATE.SCANNING) return;

    const reading = inspectIsbn(decodedText);
    if (reading.valid) {
      accept(reading.isbn13);
      return;
    }

    const now = Date.now();
    if (now - mismatchAt < MISMATCH_COOLDOWN_MS) return;

    mismatchAt = now;
    onMismatch({ raw: normalizeIsbn(decodedText) });
  }

  function ignoreFrame() {}

  async function start() {
    if (state === SCANNER_STATE.REQUESTING || state === SCANNER_STATE.SCANNING || state === SCANNER_STATE.DETECTED) return;

    const blocked = blocker();
    if (blocked) {
      emit(SCANNER_STATE.BLOCKED, { reason: blocked, permanent: true });
      return;
    }

    clearRelease();
    emit(SCANNER_STATE.REQUESTING);

    const permission = await permissionState();
    if (permission === "denied") {
      emit(SCANNER_STATE.BLOCKED, { reason: "permission", permanent: true });
      return;
    }

    let scanner;
    try {
      scanner = ensureInstance();
    } catch {
      emit(SCANNER_STATE.BLOCKED, { reason: "library", permanent: true });
      return;
    }

    let target = "";

    try {
      await enumerate();
      target = preferred();
      publish();
    } catch {
      devices = [];
    }

    if (permission === "granted" && devices.length === 0) {
      emit(SCANNER_STATE.BLOCKED, { reason: "no-camera", permanent: true });
      return;
    }

    const fallback = { facingMode: { ideal: "environment" } };
    const attempts = target ? [target, fallback] : [fallback];

    for (const attempt of attempts) {
      try {
        await scanner.start(attempt, { fps: FRAME_RATE }, handleDecode, ignoreFrame);
        await adoptRunningCamera();
        emit(SCANNER_STATE.SCANNING);
        return;
      } catch (error) {
        lastError = error;

        if (classify(error) === "permission") {
          emit(SCANNER_STATE.BLOCKED, { reason: "permission", permanent: true });
          return;
        }
      }
    }

    emit(SCANNER_STATE.BLOCKED, { reason: classify(lastError) });
  }

  async function stop() {
    clearRelease();
    await halt();
    if (state !== SCANNER_STATE.IDLE) emit(SCANNER_STATE.IDLE);
  }

  async function scanFile(file) {
    clearRelease();
    await halt();

    let scanner;
    try {
      scanner = ensureInstance();
    } catch {
      emit(SCANNER_STATE.BLOCKED, { reason: "library" });
      return;
    }

    emit(SCANNER_STATE.REQUESTING, { via: "file" });

    try {
      const reading = inspectIsbn(await scanner.scanFile(file, true));
      if (!reading.valid) {
        emit(SCANNER_STATE.ERROR, { reason: "unreadable" });
        onMismatch({ raw: normalizeIsbn(reading.normalized) });
        return;
      }

      emit(SCANNER_STATE.DETECTED, { isbn: reading.isbn13 });
      releaseTimer = setTimeout(() => onDetected({ isbn: reading.isbn13 }), FLASH_MS);
    } catch {
      emit(SCANNER_STATE.ERROR, { reason: "unreadable" });
    }
  }

  async function pause() {
    if (state !== SCANNER_STATE.SCANNING || !instance) return;

    try {
      instance.pause(true);
      emit(SCANNER_STATE.PAUSED);
    } catch {
      emit(SCANNER_STATE.ERROR, { reason: "unknown" });
    }
  }

  async function resume() {
    if (state !== SCANNER_STATE.PAUSED || !instance) return;

    try {
      await instance.resume();
      emit(SCANNER_STATE.SCANNING);
    } catch {
      emit(SCANNER_STATE.ERROR, { reason: "unknown" });
    }
  }

  async function selectCamera(id) {
    if (!id || id === activeId) return;

    const resuming = state === SCANNER_STATE.SCANNING || state === SCANNER_STATE.PAUSED;
    await stop();
    writeCamera(id);

    if (resuming) await start();
  }

  async function toggleTorch() {
    if (!instance || !activeId) return false;

    const next = !torchOn;

    try {
      await instance.applyVideoConstraints({ advanced: [{ torch: next }] });
      torchOn = next;
    } catch {
      torchOn = false;
    }

    publish();
    return torchOn;
  }

  function handleVisibility() {
    if (document.hidden) pause();
    else resume();
  }

  async function destroy() {
    document.removeEventListener("visibilitychange", handleVisibility);
    clearRelease();
    await halt();
    state = SCANNER_STATE.IDLE;
  }

  document.addEventListener("visibilitychange", handleVisibility);

  return { start, stop, scanFile, pause, resume, selectCamera, toggleTorch, destroy, getState: () => state };
}