const DB_NAME = "escocia-offline";
const DB_VERSION = 1;
const ASSETS = "assets";
const META = "meta";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(storeName, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let value;
    try {
      value = operation(store);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("Transacción cancelada"));
    };
  });
}

export function putAsset(name, blob) {
  return transact(ASSETS, "readwrite", store => store.put(blob, name));
}

export async function getAsset(name) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS, "readonly");
    const request = tx.objectStore(ASSETS).get(name);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function listAssets() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS, "readonly");
    const request = tx.objectStore(ASSETS).getAllKeys();
    request.onsuccess = () => resolve(request.result.map(String));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export function putMeta(key, value) {
  return transact(META, "readwrite", store => store.put(value, key));
}

export async function getMeta(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META, "readonly");
    const request = tx.objectStore(META).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function clearPrivateData() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ASSETS, META], "readwrite");
    tx.objectStore(ASSETS).clear();
    tx.objectStore(META).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
