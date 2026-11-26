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
import {
  deleteChat,
  loadChats,
  loadReferences,
  saveChat,
  saveReference,
} from "@/lib/storage";

type ReferencesContextValue = {
  references: DesignReference[];
  /** Generation chats, most recently active first. */
  chats: Chat[];
  ready: boolean;
  /** Resolves once the reference is stored; rejects if the browser refuses it. */
  addReference: (ref: DesignReference) => Promise<void>;
  getById: (id: string) => DesignReference | undefined;
  saveChat: (chat: Chat) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
};

const ReferencesContext = createContext<ReferencesContextValue | null>(null);

export function ReferencesProvider({ children }: { children: ReactNode }) {
  const [references, setReferences] = useState<DesignReference[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadReferences(), loadChats()])
      .then(([refs, savedChats]) => {
        if (cancelled) return;
        setReferences(refs);
        setChats(savedChats);
      })
      .catch(() => {
        // Storage unavailable (e.g. private mode): start with an empty library.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addReference = useCallback(async (ref: DesignReference) => {
    await saveReference(ref);
    setReferences((prev) => [ref, ...prev.filter((r) => r.id !== ref.id)]);
  }, []);

  const getById = useCallback(
    (id: string) => references.find((r) => r.id === id),
    [references],
  );

  const storeChat = useCallback(async (chat: Chat) => {
    // Show it at once; the write to storage follows.
    setChats((prev) => [chat, ...prev.filter((c) => c.id !== chat.id)]);
    await saveChat(chat);
  }, []);

  const removeChat = useCallback(async (id: string) => {
    await deleteChat(id);
    setChats((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      references,
      chats,
      ready,
      addReference,
      getById,
      saveChat: storeChat,
      removeChat,
    }),
    [references, chats, ready, addReference, getById, storeChat, removeChat],
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
