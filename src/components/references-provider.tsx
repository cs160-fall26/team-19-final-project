"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Chat, DesignReference } from "@/lib/types";
import { deleteChat, loadChats, saveChat } from "@/lib/chat-storage";
import {
  browserLibraryCopied,
  markBrowserLibraryCopied,
  readBrowserLibrary,
} from "@/lib/browser-library";
import { loadReferences, saveReference } from "@/lib/storage";

/** Progress of copying a library this browser still held onto disk. */
export type LibraryCopy = {
  total: number;
  copied: number;
  failed: number;
  done: boolean;
  /**
   * Why the first failed reference could not be stored. With a total of 0,
   * why the browser's library could not be read at all.
   */
  error?: string;
};

type ReferencesContextValue = {
  references: DesignReference[];
  ready: boolean;
  /** Why the library could not be read from disk, when it could not. */
  loadError: string | null;
  /** Null unless this browser held references that were not on disk yet. */
  libraryCopy: LibraryCopy | null;
  /** Resolves once the reference is stored; rejects if the server refuses it. */
  addReference: (ref: DesignReference) => Promise<void>;
  getById: (id: string) => DesignReference | undefined;
  /** Generation chats, most recently active first. Kept in this browser. */
  chats: Chat[];
  saveChat: (chat: Chat) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
};

const ReferencesContext = createContext<ReferencesContextValue | null>(null);

function reason(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function ReferencesProvider({ children }: { children: ReactNode }) {
  const [references, setReferences] = useState<DesignReference[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [libraryCopy, setLibraryCopy] = useState<LibraryCopy | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadChats()
      .then((saved) => {
        if (!cancelled) setChats(saved);
      })
      .catch(() => {
        // Storage unavailable (e.g. private mode): start without past chats.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const storeChat = useCallback(async (chat: Chat) => {
    // Show it at once; the write to storage follows.
    setChats((prev) => [chat, ...prev.filter((c) => c.id !== chat.id)]);
    await saveChat(chat);
  }, []);

  const removeChat = useCallback(async (id: string) => {
    await deleteChat(id);
    setChats((prev) => prev.filter((c) => c.id !== id));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let stored: DesignReference[];
      try {
        stored = await loadReferences();
      } catch (cause) {
        if (cancelled) return;
        setLoadError(reason(cause, "Could not load the library."));
        setReady(true);
        return;
      }

      // References captured before the library moved to disk are still in
      // this browser. Show them straight away and copy them over.
      let unsaved: DesignReference[] = [];
      let unreadable: string | undefined;
      if (!browserLibraryCopied()) {
        try {
          const onDisk = new Set(stored.map((ref) => ref.id));
          unsaved = (await readBrowserLibrary()).filter(
            (ref) => !onDisk.has(ref.id),
          );
          if (unsaved.length === 0) markBrowserLibraryCopied();
        } catch (cause) {
          unreadable = reason(cause, "Browser storage is not available.");
        }
      }
      if (cancelled) return;
      setReferences(
        [...unsaved, ...stored].sort((a, b) =>
          b.addedAt.localeCompare(a.addedAt),
        ),
      );
      setReady(true);
      if (unreadable) {
        setLibraryCopy({
          total: 0,
          copied: 0,
          failed: 0,
          done: true,
          error: unreadable,
        });
        return;
      }
      if (unsaved.length === 0) return;

      const progress: LibraryCopy = {
        total: unsaved.length,
        copied: 0,
        failed: 0,
        done: false,
      };
      setLibraryCopy({ ...progress });
      for (const ref of unsaved) {
        try {
          await saveReference(ref);
          progress.copied += 1;
        } catch (cause) {
          progress.failed += 1;
          progress.error ??= reason(cause, "Could not save the reference.");
        }
        if (cancelled) return;
        setLibraryCopy({ ...progress });
      }
      // A reference that failed stays in the browser and is retried next time.
      if (progress.failed === 0) markBrowserLibraryCopied();
      setLibraryCopy({ ...progress, done: true });
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const addReference = useCallback(async (ref: DesignReference) => {
    const saved = await saveReference(ref);
    setReferences((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)]);
  }, []);

  const getById = useCallback(
    (id: string) => references.find((r) => r.id === id),
    [references],
  );

  const value = useMemo(
    () => ({
      references,
      ready,
      loadError,
      libraryCopy,
      addReference,
      getById,
      chats,
      saveChat: storeChat,
      removeChat,
    }),
    [
      references,
      ready,
      loadError,
      libraryCopy,
      addReference,
      getById,
      chats,
      storeChat,
      removeChat,
    ],
  );

  return (
    <ReferencesContext.Provider value={value}>
      {children}
    </ReferencesContext.Provider>
  );
}

export function useReferences() {
  const ctx = useContext(ReferencesContext);
  if (!ctx) {
    throw new Error("useReferences must be used within ReferencesProvider");
  }
  return ctx;
}
