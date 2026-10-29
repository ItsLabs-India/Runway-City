// Saved games: IndexedDB slots in the browser, plus export / import as a .json file.
const DB = 'runway-city';
const STORE = 'saves';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const saveSlot = (slot, record) => tx('readwrite', (s) => s.put(record, slot));
export const loadSlot = (slot) => tx('readonly', (s) => s.get(slot));
export const deleteSlot = (slot) => tx('readwrite', (s) => s.delete(slot));

// What the "Continue" card shows, without loading the whole snapshot.
export function describe(world) {
  return { scenario: world.scenario.name, scenarioId: world.scenarioId, t: world.t, money: world.money, savedAt: Date.now() };
}

// JSON cannot hold Infinity (sandbox money, "never" times), so those are tagged.
const replacer = (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? { __n: String(v) } : v);
const reviver = (_k, v) => (v && typeof v === 'object' && '__n' in v && Object.keys(v).length === 1 ? Number(v.__n) : v);

export function encode(snap, meta) {
  return JSON.stringify({ app: 'runway-city', version: 1, meta, snap }, replacer);
}

export function decode(text) {
  const data = JSON.parse(text, reviver);
  if (data?.app !== 'runway-city' || data.version !== 1 || !data.snap) throw new Error('This is not a Runway City save file');
  return data;
}

export function downloadSave(snap, meta) {
  const blob = new Blob([encode(snap, meta)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `runway-city-${meta.scenarioId}-day${Math.floor(meta.t / 86400) + 1}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
