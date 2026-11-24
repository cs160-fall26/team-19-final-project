import type { DesignReference } from "@/lib/types";

// Before the library moved to disk it lived in this browser's IndexedDB.
// This module only reads that old library, so it can be copied to disk once;
// it never writes to it or deletes it.
const DB_NAME = "spar";
const STORE = "references";
const COPIED_KEY = "spar:browser-library-copied";

/** True once everything this browser held has been stored on disk. */
export function browserLibraryCopied(): boolean {
  try {
    return window.localStorage.getItem(COPIED_KEY) !== null;
  } catch {
    return false;
  }
}

export function markBrowserLibraryCopied(): void {
  try {
    window.localStorage.setItem(COPIED_KEY, new Date().toISOString());
  } catch {
    // Without localStorage the copy is simply checked again next time.
  }
}

/** The references this browser still holds; empty when it never held any. */
export function readBrowserLibrary(): Promise<DesignReference[]> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      // A browser without IndexedDB never held a library.
      resolve([]);
      return;
    }
    const request = window.indexedDB.open(DB_NAME);
    let absent = false;

    request.onupgradeneeded = () => {
      // The database did not exist. Abort so that looking for an old library
      // does not create an empty one.
      absent = true;
      request.transaction?.abort();
    };
    request.onerror = (event) => {
      event.preventDefault();
      if (absent) resolve([]);
      else reject(request.error);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        resolve([]);
        return;
      }
      const all = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      all.onsuccess = () => {
        db.close();
        resolve(all.result as DesignReference[]);
      };
      all.onerror = () => {
        db.close();
        reject(all.error);
      };
    };
  });
}
