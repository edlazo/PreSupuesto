/**
 * Turning what the camera and the microphone give us into something the
 * assistant can read.
 *
 * A photo straight off a phone is several megabytes and often sideways, and a
 * recording comes in whatever container the browser felt like using — Chrome
 * writes WebM, Safari writes MP4. Both are fixed here rather than on the
 * server: the photo is shrunk and turned upright, and the recording is decoded
 * and written out as 16 kHz mono WAV, the one audio format every assistant
 * accepts. Sending less also matters because a deployed request body can only
 * be 4.5 MB.
 */

import type { ChatAttachment } from "./types";

// These mirror the limits enforced in backend/models.py. Base64 adds a third
// on top of the bytes, which is what keeps them this far below 4.5 MB.
export const MAX_IMAGE_BYTES = 1_500_000;
export const MAX_AUDIO_BYTES = 2_100_000;

/** How many photos and recordings one message may carry. */
export const MAX_ATTACHMENTS = 3;

/** Long side of a photo, in pixels. Plenty to read handwriting from. */
export const MAX_IMAGE_EDGE = 1600;
/** Tried in order until the photo fits; handwriting survives all of these. */
const IMAGE_QUALITIES = [0.75, 0.6, 0.45] as const;

/** Speech is listened to at 16 kHz, so there is nothing to gain above it. */
export const RECORDING_SAMPLE_RATE = 16_000;
/**
 * A minute of speech is 1.9 MB at that rate, which is as much as one request
 * carries. Enough to describe a few jobs; longer ones go as a second message.
 */
export const MAX_RECORDING_SECONDS = 60;

/** A photo or a recording waiting to be sent, and how to show it meanwhile. */
export interface PendingAttachment {
  id: string;
  payload: ChatAttachment;
  /** A thumbnail, for a photo. */
  preview?: string;
  /** How long it runs, for a recording. */
  seconds?: number;
}

/** Raised with a message worth showing when something cannot be prepared. */
export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

// ---------------------------------------------------------------------------
// Plain arithmetic
// ---------------------------------------------------------------------------
/** Base64 for bytes, in chunks: one call with a megabyte of them overflows. */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }

  return btoa(binary);
}

/** Average the channels of a recording into one. */
export function mixChannels(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) {
    return channels[0];
  }

  const mixed = new Float32Array(channels[0]?.length ?? 0);

  for (let index = 0; index < mixed.length; index += 1) {
    let total = 0;
    for (const channel of channels) {
      total += channel[index] ?? 0;
    }
    mixed[index] = total / channels.length;
  }

  return mixed;
}

/**
 * Drop a recording down to a lower sample rate.
 *
 * Each output sample is the average of the input samples it covers, which
 * takes the edge off the aliasing a plain pick-every-nth would cause. The
 * browser's own resampler is used when it can be; this is the fallback.
 */
export function resampleMono(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) {
    return samples;
  }

  const ratio = from / to;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const resampled = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));

    let total = 0;
    for (let source = start; source < end; source += 1) {
      total += samples[source];
    }
    resampled[index] = total / (end - start);
  }

  return resampled;
}

/** Write samples as a 16-bit PCM mono WAV, header and all. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const BYTES_PER_SAMPLE = 2;
  const HEADER_BYTES = 44;
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const wav = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(wav.buffer);

  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  ascii(0, "RIFF");
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // Length of this block.
  view.setUint16(20, 1, true); // Uncompressed PCM.
  view.setUint16(22, 1, true); // Mono.
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true); // Bytes per second.
  view.setUint16(32, BYTES_PER_SAMPLE, true); // Bytes per frame.
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true); // Bits per sample.
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    // Negative samples reach one step further than positive ones.
    view.setInt16(
      HEADER_BYTES + index * BYTES_PER_SAMPLE,
      Math.round(clamped * (clamped < 0 ? 0x8000 : 0x7fff)),
      true,
    );
  }

  return wav;
}

/** How many samples still fit in a request: 60 s at 16 kHz, with room spare. */
export function maxRecordedSamples(): number {
  return Math.floor((MAX_AUDIO_BYTES - 44) / 2);
}

/** A length as a clock reads it: 7 -> "0:07", 95 -> "1:35". */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// The browser bits
// ---------------------------------------------------------------------------
let nextId = 0;

function attachmentId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

/**
 * Shrink a photo and turn it upright, ready to send.
 *
 * Phones write the orientation into the file rather than rotating the pixels,
 * so a portrait photo of a note arrives on its side unless it is read back
 * `from-image`. Sideways handwriting is much harder to read.
 */
export async function buildPhoto(file: File): Promise<PendingAttachment> {
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new AttachmentError("No pude abrir esa imagen. Probá sacar la foto de nuevo.");
  }

  try {
    for (const edge of [MAX_IMAGE_EDGE, MAX_IMAGE_EDGE / 2]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));

      const context = canvas.getContext("2d");
      if (!context) {
        throw new AttachmentError("No pude preparar la foto en este navegador.");
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of IMAGE_QUALITIES) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );

        if (blob && blob.size <= MAX_IMAGE_BYTES) {
          const content = toBase64(new Uint8Array(await blob.arrayBuffer()));
          return {
            id: attachmentId("foto"),
            payload: { kind: "image", mime_type: "image/jpeg", content },
            preview: `data:image/jpeg;base64,${content}`,
          };
        }
      }
    }
  } finally {
    bitmap.close();
  }

  throw new AttachmentError("Esa foto es demasiado grande. Probá sacarla de nuevo.");
}

/** Decode whatever the recorder produced; the browser knows its own format. */
async function decodeRecording(blob: Blob): Promise<AudioBuffer> {
  const Context: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  if (!Context) {
    throw new AttachmentError("Este navegador no puede procesar audio.");
  }

  const context = new Context();

  try {
    return await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new AttachmentError("No se pudo leer la grabación. Probá grabar de nuevo.");
  } finally {
    void context.close();
  }
}

/** One channel at 16 kHz, resampled by the browser where it will do it. */
async function toMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  if (buffer.sampleRate === RECORDING_SAMPLE_RATE && buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }

  try {
    const frames = Math.max(1, Math.round(buffer.duration * RECORDING_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frames, RECORDING_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();

    return (await offline.startRendering()).getChannelData(0);
  } catch {
    // Older Safari refuses an offline context below 44.1 kHz.
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
      buffer.getChannelData(index),
    );
    return resampleMono(mixChannels(channels), buffer.sampleRate, RECORDING_SAMPLE_RATE);
  }
}

/** A recording, re-encoded as the WAV the assistant listens to. */
export async function buildRecording(blob: Blob): Promise<PendingAttachment> {
  const decoded = await decodeRecording(blob);
  const samples = await toMono16k(decoded);
  // The recorder stops itself well before this; a stopwatch that was paused
  // with the screen off is what could still get past it.
  const trimmed = samples.subarray(0, maxRecordedSamples());
  const wav = encodeWav(trimmed, RECORDING_SAMPLE_RATE);

  return {
    id: attachmentId("audio"),
    payload: { kind: "audio", mime_type: "audio/wav", content: toBase64(wav) },
    seconds: trimmed.length / RECORDING_SAMPLE_RATE,
  };
}
