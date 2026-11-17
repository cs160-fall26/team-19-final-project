import type { DesignReference } from "@/lib/types";

// IndexedDB rather than localStorage: a handful of real photos exceeds the
// ~5 MB localStorage quota.
// Keeps the app's former name: renaming the database would orphan every
// reference already saved in a user's browser.
const DB_NAME = "spar";
const DB_VERSION = 1;
const STORE = "references";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadReferences(): Promise<DesignReference[]> {
  const db = await openDb();
  try {
    const refs = await new Promise<DesignReference[]>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as DesignReference[]);
      request.onerror = () => reject(request.error);
    });
    return refs.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  } finally {
    db.close();
  }
}

export async function saveReference(ref: DesignReference): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(ref);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
