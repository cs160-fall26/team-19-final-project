import type { Chat } from "@/lib/types";

// Generation chats stay in this browser's IndexedDB. They share the database
// the library used before it moved to disk (src/lib/browser-library.ts reads
// that old library); version 3 adds the chats store. Version 2 added a
// "generations" store that is no longer used.
const DB_NAME = "spar";
const DB_VERSION = 3;
const CHATS = "chats";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHATS)) {
        db.createObjectStore(CHATS, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function write(change: (chats: IDBObjectStore) => void): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHATS, "readwrite");
      change(tx.objectStore(CHATS));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Every chat, most recently active first. */
export async function loadChats(): Promise<Chat[]> {
  const db = await openDb();
  try {
    const chats = await new Promise<Chat[]>((resolve, reject) => {
      const request = db.transaction(CHATS, "readonly").objectStore(CHATS).getAll();
      request.onsuccess = () => resolve(request.result as Chat[]);
      request.onerror = () => reject(request.error);
    });
    return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    db.close();
  }
}

export function saveChat(chat: Chat): Promise<void> {
  return write((chats) => chats.put(chat));
}

export function deleteChat(id: string): Promise<void> {
  return write((chats) => chats.delete(id));
}
