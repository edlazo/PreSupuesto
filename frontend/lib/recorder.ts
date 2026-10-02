/**
 * Recording a voice note with the phone's microphone.
 *
 * What comes out is whatever container the browser prefers — WebM on Chrome,
 * MP4 on Safari — which `lib/attachments` then re-encodes. Nothing here cares
 * which one it was.
 */

/** Containers in order of preference; every browser supports one of them. */
const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

/** Raised with a message worth showing when recording cannot start. */
export class RecorderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecorderError";
  }
}

export interface Recording {
  blob: Blob;
  seconds: number;
}

export interface RecorderHandle {
  /** Stop recording and hand back what was captured. */
  stop(): Promise<Recording>;
  /** Stop recording and throw it away. */
  cancel(): void;
}

/** True when this browser can record at all, so the button can be hidden. */
export function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

function pickMimeType(): string | undefined {
  return PREFERRED_TYPES.find(
    (type) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type),
  );
}

/**
 * Start recording, or explain why it could not start.
 *
 * Must be called from something the user did: browsers only hand over a
 * microphone on the back of a tap.
 */
export async function startRecording(): Promise<RecorderHandle> {
  if (!canRecord()) {
    throw new RecorderError("Este navegador no puede grabar audio.");
  }

  let stream: MediaStream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";

    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new RecorderError(
        "No tengo permiso para usar el micrófono. Habilitalo para este sitio y probá de nuevo.",
      );
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      throw new RecorderError("No encontré ningún micrófono en este dispositivo.");
    }

    throw new RecorderError("No pude abrir el micrófono. Probá de nuevo.");
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  const startedAt = Date.now();

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  /** Let go of the microphone, so the phone drops its recording indicator. */
  const release = () => {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };

  recorder.start();

  return {
    stop() {
      return new Promise<Recording>((resolve, reject) => {
        if (recorder.state === "inactive") {
          release();
          reject(new RecorderError("La grabación se cortó sola. Probá de nuevo."));
          return;
        }

        recorder.addEventListener("stop", () => {
          release();
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });

          if (blob.size === 0) {
            reject(new RecorderError("No se grabó nada. Fijate que el micrófono esté libre."));
            return;
          }

          resolve({ blob, seconds: (Date.now() - startedAt) / 1000 });
        });

        recorder.stop();
      });
    },

    cancel() {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      release();
    },
  };
}
