"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AttachmentError,
  MAX_ATTACHMENTS,
  MAX_RECORDING_SECONDS,
  buildPhoto,
  buildRecording,
  formatDuration,
  type PendingAttachment,
} from "@/lib/attachments";
import { RecorderError, canRecord, startRecording, type RecorderHandle } from "@/lib/recorder";

/** Whether recording works never changes during a visit. */
function subscribeToNothing(): () => void {
  return () => {};
}

/** On the server there is no microphone: the button waits for hydration. */
function cannotRecordOnServer(): boolean {
  return false;
}

function messageFor(caught: unknown): string {
  if (caught instanceof AttachmentError || caught instanceof RecorderError) {
    return caught.message;
  }

  return "No pude preparar eso. Probá de nuevo.";
}

/**
 * What the message is written with: the text box, and the two ways around it.
 *
 * Typing on a phone is slow and error-prone for the person using this, so the
 * work can also be said out loud or photographed off the paper it is written
 * on. A recording is sent the moment it is stopped, the way a voice note is;
 * photos wait, so several can go together with a line of text.
 */
export default function ChatComposer({
  isSending,
  onSend,
}: {
  isSending: boolean;
  onSend: (message: string, attachments: PendingAttachment[]) => void;
}) {
  const canUseMicrophone = useSyncExternalStore(
    subscribeToNothing,
    canRecord,
    cannotRecordOnServer,
  );

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const timerRef = useRef<number | null>(null);
  // The stopwatch runs the clock and can also stop the recording by itself, by
  // which time what is typed may have moved on from what its closure captured.
  const draftRef = useRef({ text, attachments });

  useEffect(() => {
    draftRef.current = { text, attachments };
  }, [text, attachments]);

  // Leaving the page mid-recording must still hand the microphone back.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
      recorderRef.current?.cancel();
    },
    [],
  );

  const isBusy = isSending || isPreparing;
  const hasRoom = attachments.length < MAX_ATTACHMENTS;

  function stopTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function submit(message: string, items: PendingAttachment[]) {
    if (!message.trim() && items.length === 0) {
      return;
    }

    onSend(message.trim(), items);
    setText("");
    setAttachments([]);
    setError(null);
  }

  /** Stop recording and send it, the way letting go of a voice note does. */
  async function finishRecording() {
    const handle = recorderRef.current;

    if (!handle) {
      return;
    }

    stopTimer();
    recorderRef.current = null;
    setIsRecording(false);
    setIsPreparing(true);

    try {
      const recording = await handle.stop();
      const built = await buildRecording(recording.blob);
      const draft = draftRef.current;
      submit(draft.text, [...draft.attachments, built]);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setIsPreparing(false);
    }
  }

  function discardRecording() {
    stopTimer();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setIsRecording(false);
  }

  async function beginRecording() {
    setError(null);

    try {
      const handle = await startRecording();
      recorderRef.current = handle;
      const startedAt = Date.now();

      setElapsed(0);
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        const seconds = (Date.now() - startedAt) / 1000;
        setElapsed(seconds);

        if (seconds >= MAX_RECORDING_SECONDS) {
          void finishRecording();
        }
      }, 200);
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    setError(null);
    setIsPreparing(true);

    const room = MAX_ATTACHMENTS - attachments.length;
    const chosen = Array.from(files).slice(0, room);

    try {
      for (const file of chosen) {
        const photo = await buildPhoto(file);
        setAttachments((current) => [...current, photo]);
      }

      if (files.length > chosen.length) {
        setError(`Puedo mirar hasta ${MAX_ATTACHMENTS} fotos por mensaje.`);
      }
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setIsPreparing(false);
    }
  }

  if (isRecording) {
    return (
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-3 rounded-xl border border-danger bg-danger-soft p-3">
          <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-danger" />
          </span>

          <div className="min-w-0 flex-1" aria-live="off">
            <p className="text-sm font-semibold text-danger tabular-nums">
              Grabando {formatDuration(elapsed)}
            </p>
            <p className="truncate text-xs text-muted">
              Contá el trabajo y cuánto cobrás. Hasta {MAX_RECORDING_SECONDS} segundos.
            </p>
          </div>

          <button
            type="button"
            onClick={discardRecording}
            aria-label="Descartar la grabación"
            title="Descartar"
            className="rounded-lg px-2 py-1.5 text-sm text-muted transition-colors hover:text-danger"
          >
            ✕
          </button>
          <button
            type="button"
            onClick={() => void finishRecording()}
            className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Listo
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="border-t border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isBusy) {
          submit(text, attachments);
        }
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {canUseMicrophone ? (
            <button
              type="button"
              onClick={() => void beginRecording()}
              disabled={isBusy}
              title="Grabar un audio contando el trabajo"
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-surface-muted text-sm font-medium transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">🎤</span> Hablar
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy || !hasRoom}
            title="Sacar o elegir una foto de los trabajos anotados"
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-surface-muted text-sm font-medium transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true">📷</span> Foto
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              void addPhotos(event.target.files);
              // Cleared so choosing the same photo again still counts.
              event.target.value = "";
            }}
          />
        </div>

        {attachments.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {attachments.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted py-1 pl-1 pr-1 text-xs"
              >
                {item.preview ? (
                  // A data URL of a photo already in memory: nothing for
                  // next/image to fetch, size or cache.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.preview}
                    alt="Foto adjunta"
                    className="h-9 w-9 rounded object-cover"
                  />
                ) : (
                  <span className="px-1.5 text-base" aria-hidden="true">
                    🎤
                  </span>
                )}
                <span className="font-medium">
                  {item.payload.kind === "image"
                    ? "Foto"
                    : `Audio ${formatDuration(item.seconds ?? 0)}`}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((current) => current.filter((other) => other.id !== item.id))
                  }
                  aria-label="Quitar lo adjunto"
                  className="rounded px-1.5 py-1 text-muted transition-colors hover:text-danger"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-end gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Mensaje
          </label>
          <textarea
            id="chat-input"
            rows={2}
            value={text}
            disabled={isBusy}
            placeholder="Ej.: presupuestá 15 m² de piso de cocina con porcelanato"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter adds a line break.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!isBusy) {
                  submit(text, attachments);
                }
              }
            }}
            className="min-h-[3rem] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-primary disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isBusy || (text.trim().length === 0 && attachments.length === 0)}
            className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPreparing ? "Preparando…" : "Enviar"}
          </button>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
