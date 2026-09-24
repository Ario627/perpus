const SETTINGS_KEY = "perpus_settings_v1";

const DEFAULTS = Object.freeze({
  preferredCameraId: "",
});

let cache = null;

function sanitize(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;

  if ("preferredCameraId" in raw) out.preferredCameraId = String(raw.preferredCameraId ?? "").trim();

  return out;
}

export function readSettings() {
  if (cache) return cache;

  try {
    cache = { ...DEFAULTS, ...sanitize(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}")) };
  } catch {
    cache = { ...DEFAULTS };
  }

  return cache;
}

export function writeSettings(patch) {
  const next = { ...readSettings(), ...sanitize(patch) };
  cache = next;

  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export const preferredCamera = () => readSettings().preferredCameraId;
