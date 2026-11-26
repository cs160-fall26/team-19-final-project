import type { Chat, DesignReference } from "@/lib/types";

// IndexedDB rather than localStorage: a handful of real photos exceeds the
// ~5 MB localStorage quota.
// Keeps the app's former name: renaming the database would orphan every
// reference already saved in a user's browser.
const DB_NAME = "spar";
// Version 3 adds the chats store. (Version 2's "generations" store is unused.)
const DB_VERSION = 3;
const STORE = "references";
const CHATS = "chats";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CHATS)) {
        db.createObjectStore(CHATS, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const request = db.transaction(store, "readonly").objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function write(
  store: string,
  change: (objects: IDBObjectStore) => void,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      change(tx.objectStore(store));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadReferences(): Promise<DesignReference[]> {
  const refs = await getAll<DesignReference>(STORE);
  return refs.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export function saveReference(ref: DesignReference): Promise<void> {
  return write(STORE, (objects) => objects.put(ref));
}

export async function loadChats(): Promise<Chat[]> {
  const chats = await getAll<Chat>(CHATS);
  return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveChat(chat: Chat): Promise<void> {
  return write(CHATS, (objects) => objects.put(chat));
}

export function deleteChat(id: string): Promise<void> {
  return write(CHATS, (objects) => objects.delete(id));
}
