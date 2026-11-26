"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  Move,
  Paperclip,
  Plus,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { ReferencePicker } from "@/components/reference-picker";
import { useReferences } from "@/components/references-provider";
import {
  chatPastedImages,
  chatReferenceIds,
  imageFileToPasted,
  requestGeneration,
  resolveReference,
  takeStashedReferences,
  withReferenceImages,
  withReferenceTokens,
  type GenerationReference,
} from "@/lib/generation";
import {
  EDITOR_KEYS,
  EDITOR_MESSAGE,
  readEditedHtml,
  sendEditorCommand,
  sendEditorKey,
  withEditor,
} from "@/lib/design-editor";
import type {
  Chat,
  DesignMessage,
  PastedImage,
  UserMessage,
} from "@/lib/types";

const PRESETS: { label: string; brief: string }[] = [
  {
    label: "Wordmark logo",
    brief:
      "A wordmark logo that uses reference 1 itself as the logo mark, set beside a name in a typeface that matches its character. Show it large on a plain background.",
  },
  {
    label: "Poster",
    brief:
      "A typographic poster built around the attached references, using their colours and textures.",
  },
  {
    label: "Pattern tile",
    brief:
      "A seamless repeating pattern inspired by the form and material of the attached references, filling the page.",
  },
  {
    label: "Palette card",
    brief:
      "A colour and material card: each attached reference image with its palette as labelled swatches with hex codes, and a few words on texture and finish.",
  },
  {
    label: "Landing hero",
    brief:
      "The hero section of a website for a fictional studio whose identity comes from the attached references.",
  },
];

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Generated code runs in an opaque origin: it can run scripts but not reach the app. */
function DesignFrame({
  html,
  title,
  className,
  frameRef,
}: {
  html: string;
  title: string;
  className?: string;
  frameRef?: React.Ref<HTMLIFrameElement>;
}) {
  return (
    <iframe
      ref={frameRef}
      title={title}
      srcDoc={html}
      sandbox="allow-scripts"
      className={className}
    />
  );
}

export function GenerateView() {
  const { references, chats, ready, getById, saveChat, removeChat } =
    useReferences();
  const [chatId, setChatId] = useState<string | null>(null);
  const [attached, setAttached] = useState<string[]>([]);
  /** Images pasted or dropped into the composer, not yet sent. */
  const [pasted, setPasted] = useState<PastedImage[]>([]);
  /** What the model has written so far for the reply in progress. */
  const [progress, setProgress] = useState<{
    status: string;
    chars: number;
    partial: string;
    revising: boolean;
  } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDesignId, setActiveDesignId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /** The design open in Edit mode, if any. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Whether the edit history has something to undo; the same as "unsaved changes". */
  const [editDirty, setEditDirty] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const started = useRef(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const chat = chats.find((c) => c.id === chatId) ?? null;
  const messages = useMemo(() => chat?.messages ?? [], [chat]);
  const designs = messages.filter(
    (m): m is DesignMessage => m.role === "assistant",
  );
  const active =
    designs.find((d) => d.id === activeDesignId) ?? designs.at(-1) ?? null;

  // References are numbered by their place in the chat, so "reference 2"
  // means the same picture in every message and in the HTML.
  const chatRefIds = useMemo(() => chatReferenceIds({ messages }), [messages]);
  const knownPasted = useMemo(
    () => [...chatPastedImages({ messages }), ...pasted],
    [messages, pasted],
  );
  const lookup = (id: string) => resolveReference(id, getById, knownPasted);
  const chatImages = useMemo(
    () =>
      chatRefIds.map(
        (id) => resolveReference(id, getById, knownPasted)?.image ?? "",
      ),
    [chatRefIds, getById, knownPasted],
  );
  const render = (design: DesignMessage) =>
    withReferenceImages(design.html, chatImages);
  const numberOf = (id: string) => {
    const i = chatRefIds.indexOf(id);
    return i === -1 ? chatRefIds.length + attached.indexOf(id) + 1 : i + 1;
  };
  const lastIsUnanswered = messages.at(-1)?.role === "user";

  // On arrival: a selection from the library starts a new chat; otherwise
  // pick up the most recent one.
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    const handed = takeStashedReferences().filter((id) => getById(id));
    /* eslint-disable react-hooks/set-state-in-effect -- one-time setup once storage has loaded */
    if (handed.length > 0) {
      setAttached(handed);
    } else if (chats[0]) {
      setChatId(chats[0].id);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [ready, chats, getById]);

  // Keep the newest message in view.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages.length, busy, error, progress?.status]);

  const editing = active !== null && active.id === editingId;

  // The editing frame reports its history after each move, text edit,
  // deletion, undo and redo.
  useEffect(() => {
    if (!editing) return;
    function onMessage(event: MessageEvent) {
      if (event.source !== previewRef.current?.contentWindow) return;
      const data = event.data as { type?: string; canUndo?: boolean; canRedo?: boolean };
      if (data?.type === EDITOR_MESSAGE.changed) {
        setEditDirty(Boolean(data.canUndo));
        setCanRedo(Boolean(data.canRedo));
      }
    }
    // Editing keys also work when the focus is in the app rather than the
    // design, e.g. right after clicking Edit. Text fields keep their own keys.
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && (key === "z" || key === "y")) {
        event.preventDefault();
        sendEditorCommand(
          previewRef.current,
          key === "y" || event.shiftKey ? "redo" : "undo",
        );
      } else if (!event.metaKey && !event.ctrlKey && EDITOR_KEYS.has(event.key)) {
        event.preventDefault();
        sendEditorKey(previewRef.current, event.key, event.shiftKey);
      }
    }
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editing]);

  function startEditing() {
    if (!active) return;
    setEditingId(active.id);
    setEditDirty(false);
    setCanRedo(false);
    setError(null);
  }

  function stopEditing() {
    setEditingId(null);
    setEditDirty(false);
    setCanRedo(false);
  }

  /** Saves the hand-edited page as the chat's newest design. */
  async function saveEdit() {
    if (!chat || !active || !previewRef.current) return;
    setSavingEdit(true);
    try {
      const html = await readEditedHtml(previewRef.current);
      const design: DesignMessage = {
        id: newId("design"),
        role: "assistant",
        html: withReferenceTokens(html, chatImages),
        model: active.model,
        editedByHand: true,
        createdAt: new Date().toISOString(),
      };
      await saveChat({
        ...chat,
        messages: [...chat.messages, design],
        updatedAt: design.createdAt,
      });
      setActiveDesignId(design.id);
      stopEditing();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Could not save the edit.",
      );
    } finally {
      setSavingEdit(false);
    }
  }

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  /** Asks the model to answer the chat's last message, which is the designer's. */
  async function answer(current: Chat) {
    const last = current.messages.at(-1);
    if (!last || last.role !== "user") return;
    const earlier = current.messages.slice(0, -1);
    const previous = earlier
      .filter((m): m is DesignMessage => m.role === "assistant")
      .at(-1);
    const allPasted = chatPastedImages(current);
    // On a revision the model already has the earlier images in the HTML, so
    // only images new in this message are sent: much less to upload and read.
    const seenBefore = new Set(chatReferenceIds({ messages: earlier }));
    const refs: GenerationReference[] = chatReferenceIds(current).map((id) => {
      const ref = resolveReference(id, getById, allPasted);
      if (!ref) {
        // Keeps later references at their numbers.
        return { title: "Missing reference", semantic: "", labels: [], palette: [] };
      }
      const { image, title, semantic, labels, palette, note } = ref;
      return {
        image: previous && seenBefore.has(id) ? undefined : image,
        title,
        semantic,
        labels,
        palette,
        note,
      };
    });

    setBusy(true);
    setError(null);
    const revising = Boolean(previous);
    let written = "";
    let lastShown = 0;
    setProgress({
      status: revising ? "Working out the changes…" : "Starting the design…",
      chars: 0,
      partial: "",
      revising,
    });
    try {
      const result = await requestGeneration(
        {
          references: refs,
          history: earlier
            .filter((m): m is UserMessage => m.role === "user")
            .map((m) => m.text),
          brief: last.text,
          previous: previous?.html,
        },
        (event) => {
          if (event.type === "restart") {
            written = "";
            setProgress({ status: event.text, chars: 0, partial: "", revising: false });
            return;
          }
          if (event.type === "status") {
            setProgress((p) => (p ? { ...p, status: event.text } : p));
            return;
          }
          if (event.type !== "text") return;
          written += event.text;
          // Redraw the live preview about once a second, not on every token.
          const now = Date.now();
          if (now - lastShown < 900) return;
          lastShown = now;
          const text = written;
          setProgress((p) =>
            p
              ? {
                  ...p,
                  status: p.revising ? "Writing the changes…" : "Writing the page…",
                  chars: text.length,
                  partial: text,
                }
              : p,
          );
        },
      );
      const design: DesignMessage = {
        id: newId("design"),
        role: "assistant",
        html: result.html,
        model: result.model,
        createdAt: new Date().toISOString(),
      };
      await saveChat({
        ...current,
        messages: [...current.messages, design],
        updatedAt: design.createdAt,
      });
      setActiveDesignId(design.id);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Generation failed. Try again.",
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /** Adds pasted or dropped image files to the next message. */
  async function addImageFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    try {
      const added = await Promise.all(images.map(imageFileToPasted));
      setPasted((prev) => [...prev, ...added]);
      setAttached((prev) => [...prev, ...added.map((a) => a.id)]);
    } catch {
      setError("That image could not be read. Try a PNG, JPG or WEBP.");
    }
  }

  function removeAttachment(id: string) {
    setAttached((prev) => prev.filter((x) => x !== id));
    setPasted((prev) => prev.filter((p) => p.id !== id));
  }

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const now = new Date().toISOString();
    const message: UserMessage = {
      id: newId("msg"),
      role: "user",
      text: trimmed,
      referenceIds: attached,
      pastedImages: pasted.filter((p) => attached.includes(p.id)),
      createdAt: now,
    };
    const next: Chat = chat
      ? { ...chat, messages: [...chat.messages, message], updatedAt: now }
      : {
          id: newId("chat"),
          title: trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed,
          messages: [message],
          createdAt: now,
          updatedAt: now,
        };
    setChatId(next.id);
    setText("");
    setAttached([]);
    setPasted([]);
    // A chat message revises the latest saved design, so leave Edit mode.
    setEditingId(null);
    setEditDirty(false);
    await saveChat(next);
    await answer(next);
  }

  function newChat() {
    setChatId(null);
    setActiveDesignId(null);
    setAttached([]);
    setPasted([]);
    setText("");
    setError(null);
    setChatsOpen(false);
  }

  async function copyHtml() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(render(active));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    if (!active) return;
    const url = URL.createObjectURL(
      new Blob([render(active)], { type: "text/html" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `generated-${active.id}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-white lg:h-dvh">
      <header className="grid shrink-0 grid-cols-3 items-center border-b border-black/8 px-4 py-4 md:px-8">
        <Link
          href="/"
          className="font-[family-name:var(--font-geist-pixel-square)] text-sm leading-tight tracking-tight text-black transition-opacity hover:opacity-70 md:text-lg"
        >
          world material library
        </Link>
        <div className="justify-self-center">
          <AppNav active="generate" />
        </div>
        <div aria-hidden />
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(360px,480px)_1fr]">
        {/* Chat */}
        <section className="flex min-h-0 flex-col border-black/8 lg:border-r">
          <div className="relative flex shrink-0 items-center justify-between gap-3 border-b border-black/8 px-5 py-3 md:px-6">
            <button
              type="button"
              onClick={() => setChatsOpen((o) => !o)}
              aria-expanded={chatsOpen}
              className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] tracking-wide"
            >
              <span className="truncate">{chat ? chat.title : "New chat"}</span>
              <ChevronDown className="size-3.5 shrink-0" />
            </button>
            <button
              type="button"
              onClick={newChat}
              disabled={busy}
              className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] underline-offset-4 hover:underline disabled:opacity-40"
            >
              <Plus className="size-3.5" /> New chat
            </button>

            {chatsOpen ? (
              <div className="absolute inset-x-3 top-full z-30 mt-1 max-h-80 overflow-y-auto border border-black/10 bg-white p-1 shadow-sm">
                {chats.length === 0 ? (
                  <p className="px-3 py-4 font-mono text-[11px] text-black/45">
                    No chats yet.
                  </p>
                ) : (
                  chats.map((c) => (
                    <div
                      key={c.id}
                      className={`flex items-center gap-2 px-3 py-2 ${c.id === chatId ? "bg-[#f2f2f2]" : "hover:bg-[#f7f7f7]"}`}
                    >
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setChatId(c.id);
                          setActiveDesignId(null);
                          setError(null);
                          setChatsOpen(false);
                        }}
                        className="min-w-0 flex-1 text-left disabled:opacity-40"
                      >
                        <span className="block truncate font-mono text-[11px]">
                          {c.title}
                        </span>
                        <span className="block font-mono text-[10px] text-black/40">
                          {c.messages.filter((m) => m.role === "assistant").length}{" "}
                          designs · {formatTime(c.updatedAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void removeChat(c.id);
                          if (c.id === chatId) newChat();
                        }}
                        aria-label={`Delete chat: ${c.title}`}
                        className="p-1 text-black/40 hover:text-black disabled:opacity-40"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div
            ref={threadRef}
            className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-6 max-lg:max-h-[60vh] md:px-6"
          >
            {messages.length === 0 ? (
              <div className="space-y-4 pt-4">
                <p className="text-lg leading-snug font-medium tracking-tight">
                  What should we make?
                </p>
                <p className="font-mono text-[11px] leading-relaxed text-black/50">
                  Attach references from your library, describe the design,
                  and send. Each reply is a live HTML page; follow-up messages
                  revise it.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setText(preset.brief)}
                      className="rounded-full border border-black/15 px-3 py-1 font-mono text-[10px] tracking-wide transition-colors hover:border-black hover:bg-black hover:text-white"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => {
                if (m.role === "user") {
                  return (
                    <div key={m.id} className="flex flex-col items-end gap-1.5">
                      {m.referenceIds.length > 0 ? (
                        <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
                          {m.referenceIds.map((id) => {
                            const ref = lookup(id);
                            return (
                              <span key={id} className="relative" title={ref?.title}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={ref?.image ?? ""}
                                  alt={ref?.title ?? "Missing reference"}
                                  className="size-11 bg-[#e8e8e8] object-cover"
                                />
                                <span className="absolute top-0 left-0 bg-[#CCFF00] px-1 font-mono text-[9px] leading-3.5 font-medium">
                                  {numberOf(id)}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                      <p className="max-w-[85%] bg-black px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white">
                        {m.text}
                      </p>
                    </div>
                  );
                }
                const version = designs.indexOf(m) + 1;
                const isActive = m.id === active?.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      if (editing && editDirty && !window.confirm("Discard your unsaved edits?")) return;
                      stopEditing();
                      setActiveDesignId(m.id);
                    }}
                    className={`group block w-full max-w-[85%] border text-left ${isActive ? "border-black" : "border-black/10 hover:border-black/40"}`}
                  >
                    <span className="relative block aspect-[16/10] overflow-hidden bg-[#ececec]">
                      {/* A live thumbnail: the page at 1280×800, scaled to fit. */}
                      <DesignFrame
                        html={render(m)}
                        title={`Design ${version} thumbnail`}
                        className="pointer-events-none absolute top-0 left-0 h-[800px] w-[1280px] origin-top-left scale-[0.25] border-0 bg-white sm:scale-[0.3]"
                      />
                    </span>
                    <span className="flex items-center justify-between gap-2 px-3 py-2 font-mono text-[10px] tracking-wide">
                      <span>
                        Design {version}
                        {m.editedByHand ? " · edited by hand" : ""}
                        {isActive ? " · in preview" : ""}
                      </span>
                      <span className="text-black/40">{formatTime(m.createdAt)}</span>
                    </span>
                  </button>
                );
              })
            )}

            {busy && progress ? (
              <p className="font-mono text-[11px] tracking-wide text-black/55">
                <span className="animate-pulse">{progress.status}</span>
                {progress.chars > 0
                  ? ` ${(progress.chars / 1000).toFixed(1)}k characters`
                  : ""}
              </p>
            ) : null}
            {error ? (
              <div className="space-y-2" role="alert">
                <p className="font-mono text-xs text-red-600">{error}</p>
                {chat && lastIsUnanswered ? (
                  <button
                    type="button"
                    onClick={() => void answer(chat)}
                    className="font-mono text-[11px] underline underline-offset-4"
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-black/8 px-5 py-4 md:px-6">
            {attached.length > 0 ? (
              <div className="mb-3 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {attached.map((id) => {
                  const ref = lookup(id);
                  if (!ref) return null;
                  return (
                    <span
                      key={id}
                      className="flex items-center gap-1.5 border border-black/12 bg-[#f6f6f6] py-1 pr-1 pl-1"
                      title={ref.title}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ref.image}
                        alt=""
                        className="size-6 object-cover"
                      />
                      <span className="font-mono text-[10px]">#{numberOf(id)}</span>
                      <span className="max-w-24 truncate font-mono text-[10px] text-black/55">
                        {ref.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(id)}
                        aria-label={`Remove ${ref.title}`}
                        className="p-0.5 text-black/40 hover:text-black"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}
            <div
              onDragOver={(e) => {
                if (busy || !e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={(e) => {
                setDropping(false);
                if (busy || e.dataTransfer.files.length === 0) return;
                e.preventDefault();
                void addImageFiles([...e.dataTransfer.files]);
              }}
              className={`flex items-end gap-2 border bg-[#f6f6f6] p-2 focus-within:border-black ${dropping ? "border-black bg-[#CCFF00]/15" : "border-black/15"}`}
            >
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={busy || references.length === 0}
                aria-label="Attach references"
                title={
                  references.length === 0
                    ? "Your library is empty"
                    : "Attach references from your library"
                }
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-black/60 hover:bg-black/5 hover:text-black disabled:opacity-30"
              >
                <Paperclip className="size-4" />
              </button>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => {
                  const files = [...e.clipboardData.files].filter((f) =>
                    f.type.startsWith("image/"),
                  );
                  if (files.length === 0) return;
                  // Images become attachments; any pasted text still goes in.
                  if (!e.clipboardData.getData("text/plain")) e.preventDefault();
                  void addImageFiles(files);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                maxLength={2000}
                disabled={busy}
                placeholder={
                  designs.length > 0
                    ? "Ask for a change, e.g. “make the background charcoal”"
                    : "Describe the design, e.g. “a wordmark logo for a studio called Kiln, using reference 1 as the mark”"
                }
                className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 font-mono text-[11px] leading-relaxed outline-none placeholder:text-black/35 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!text.trim() || busy}
                aria-label="Send"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#CCFF00] text-black transition-transform hover:scale-105 disabled:pointer-events-none disabled:opacity-40"
              >
                <ArrowUp className="size-4" strokeWidth={2.25} />
              </button>
            </div>
            <p className="mt-2 font-mono text-[10px] text-black/40">
              Enter to send · Shift+Enter for a new line · Paste or drop images
              to attach them
              {chatRefIds.length > 0
                ? ` · ${chatRefIds.length} reference${chatRefIds.length === 1 ? "" : "s"} in this chat`
                : ""}
            </p>
          </div>
        </section>

        {/* Preview */}
        <section className="flex min-h-[70vh] flex-col bg-[#ececec] p-4 md:p-8 lg:min-h-0">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
            <p className="font-mono text-[10px] tracking-wide text-black/50">
              {active
                ? `${editing ? "Editing" : "Preview"} · Design ${designs.indexOf(active) + 1}${active.editedByHand ? " · edited by hand" : ` · ${active.model}`}`
                : "Preview"}
            </p>
            {active && editing ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => sendEditorCommand(previewRef.current, "undo")}
                    disabled={!editDirty || savingEdit}
                    aria-label="Undo"
                    title="Undo (⌘Z / Ctrl+Z)"
                    className="flex size-7 items-center justify-center rounded-full hover:bg-black/8 disabled:opacity-30"
                  >
                    <Undo2 className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => sendEditorCommand(previewRef.current, "redo")}
                    disabled={!canRedo || savingEdit}
                    aria-label="Redo"
                    title="Redo (⇧⌘Z / Ctrl+Y)"
                    className="flex size-7 items-center justify-center rounded-full hover:bg-black/8 disabled:opacity-30"
                  >
                    <Redo2 className="size-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (editDirty && !window.confirm("Discard your unsaved edits?")) return;
                    stopEditing();
                  }}
                  disabled={savingEdit}
                  className="font-mono text-[11px] underline underline-offset-4 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={!editDirty || savingEdit}
                  className="rounded-full bg-[#CCFF00] px-4 py-1.5 font-mono text-[11px] font-medium text-black transition-transform hover:scale-[1.03] disabled:pointer-events-none disabled:opacity-40"
                >
                  {savingEdit ? "Saving…" : `Save as Design ${designs.length + 1}`}
                </button>
              </div>
            ) : active ? (
              <div className="flex items-center gap-4 font-mono text-[11px]">
                <button
                  type="button"
                  onClick={startEditing}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-black px-3 py-1 transition-colors hover:bg-black hover:text-white disabled:opacity-40"
                >
                  <Move className="size-3" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => void copyHtml()}
                  className="underline underline-offset-4"
                >
                  {copied ? "Copied" : "Copy HTML"}
                </button>
                <button
                  type="button"
                  onClick={download}
                  className="underline underline-offset-4"
                >
                  Download .html
                </button>
              </div>
            ) : null}
          </div>
          <div className={`relative flex-1 overflow-hidden bg-white ${editing ? "ring-2 ring-[#CCFF00]" : ""}`}>
            {active ? (
              <DesignFrame
                key={`${active.id}-${editing ? "edit" : "view"}`}
                frameRef={previewRef}
                html={editing ? withEditor(render(active)) : render(active)}
                title={`Design ${designs.indexOf(active) + 1}`}
                className="absolute inset-0 size-full border-0"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center font-mono text-[11px] leading-relaxed text-black/45">
                Designs from the chat appear here as live HTML pages.
              </div>
            )}
            {busy && progress && !progress.revising && progress.partial ? (
              // A new page renders as it is written; browsers draw unfinished HTML fine.
              <DesignFrame
                html={withReferenceImages(progress.partial, chatImages)}
                title="Design in progress"
                className="absolute inset-0 size-full border-0 bg-white"
              />
            ) : null}
            {busy ? (
              <div
                className={`absolute flex items-center justify-center ${progress?.partial && !progress.revising ? "inset-x-0 bottom-0 bg-white/85 py-2" : "inset-0 bg-white/70 backdrop-blur-[2px]"}`}
              >
                <span className="animate-pulse font-mono text-[11px] tracking-wide">
                  {progress?.status ?? "Working…"}
                  {progress?.chars
                    ? ` ${(progress.chars / 1000).toFixed(1)}k characters`
                    : ""}
                </span>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {pickerOpen ? (
        <ReferencePicker
          open
          onOpenChange={setPickerOpen}
          selectedIds={attached.filter((id) => !pasted.some((p) => p.id === id))}
          // The picker only covers the library; keep pasted images attached.
          onDone={(ids) =>
            setAttached([
              ...attached.filter((id) => pasted.some((p) => p.id === id)),
              ...ids,
            ])
          }
        />
      ) : null}
    </div>
  );
}
