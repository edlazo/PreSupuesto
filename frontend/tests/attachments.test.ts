/**
 * The arithmetic behind sending a photo or a recording. Run with `npm test`.
 *
 * The camera and microphone themselves only exist in a browser, so what is
 * checked here is what happens to their output afterwards: the WAV header the
 * assistant reads the recording through, the resampling down to 16 kHz, and
 * the base64 that carries either of them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_AUDIO_BYTES,
  MAX_RECORDING_SECONDS,
  RECORDING_SAMPLE_RATE,
  encodeWav,
  formatDuration,
  maxRecordedSamples,
  mixChannels,
  resampleMono,
  toBase64,
} from "../lib/attachments.ts";

/** Read the four ASCII characters a WAV chunk is named by. */
function tag(wav: Uint8Array, offset: number): string {
  return String.fromCharCode(...wav.subarray(offset, offset + 4));
}

function uint32(wav: Uint8Array, offset: number): number {
  return new DataView(wav.buffer, wav.byteOffset).getUint32(offset, true);
}

function uint16(wav: Uint8Array, offset: number): number {
  return new DataView(wav.buffer, wav.byteOffset).getUint16(offset, true);
}

function int16(wav: Uint8Array, index: number): number {
  return new DataView(wav.buffer, wav.byteOffset).getInt16(44 + index * 2, true);
}

describe("encodeWav", () => {
  const samples = new Float32Array([0, 1, -1, 0.5, -0.5]);
  const wav = encodeWav(samples, RECORDING_SAMPLE_RATE);

  it("writes a header the assistant can recognise", () => {
    assert.equal(tag(wav, 0), "RIFF");
    assert.equal(tag(wav, 8), "WAVE");
    assert.equal(tag(wav, 12), "fmt ");
    assert.equal(tag(wav, 36), "data");
    // The size in the RIFF chunk counts everything after its own first 8 bytes.
    assert.equal(uint32(wav, 4), wav.length - 8);
    assert.equal(uint32(wav, 40), samples.length * 2);
    assert.equal(wav.length, 44 + samples.length * 2);
  });

  it("declares uncompressed mono at the rate it was given", () => {
    assert.equal(uint16(wav, 20), 1, "PCM");
    assert.equal(uint16(wav, 22), 1, "one channel");
    assert.equal(uint32(wav, 24), RECORDING_SAMPLE_RATE);
    assert.equal(uint32(wav, 28), RECORDING_SAMPLE_RATE * 2, "bytes per second");
    assert.equal(uint16(wav, 32), 2, "bytes per frame");
    assert.equal(uint16(wav, 34), 16, "bits per sample");
  });

  it("uses the whole range of a 16-bit sample", () => {
    assert.equal(int16(wav, 0), 0);
    assert.equal(int16(wav, 1), 32767);
    assert.equal(int16(wav, 2), -32768);
    assert.equal(int16(wav, 3), 16384);
    assert.equal(int16(wav, 4), -16384);
  });

  it("clips anything louder instead of wrapping it around", () => {
    // Wrapping a too-loud sample turns it into its opposite, which is heard as
    // a crack over the words.
    const loud = encodeWav(new Float32Array([4, -4]), RECORDING_SAMPLE_RATE);
    assert.equal(int16(loud, 0), 32767);
    assert.equal(int16(loud, 1), -32768);
  });
});

describe("getting a recording down to 16 kHz", () => {
  it("averages the samples it merges", () => {
    const resampled = resampleMono(new Float32Array([0, 1, 2, 3, 4, 5]), 6, 2);

    assert.equal(resampled.length, 2);
    assert.equal(resampled[0], 1); // (0 + 1 + 2) / 3
    assert.equal(resampled[1], 4); // (3 + 4 + 5) / 3
  });

  it("drops a phone's 48 kHz to a third of the samples", () => {
    const second = new Float32Array(48_000);
    const resampled = resampleMono(second, 48_000, RECORDING_SAMPLE_RATE);

    assert.equal(resampled.length, RECORDING_SAMPLE_RATE);
  });

  it("leaves a recording that is already at the right rate alone", () => {
    const samples = new Float32Array([0.1, 0.2]);

    assert.equal(resampleMono(samples, RECORDING_SAMPLE_RATE, RECORDING_SAMPLE_RATE), samples);
  });

  it("averages stereo into one channel", () => {
    const mixed = mixChannels([new Float32Array([1, -1]), new Float32Array([0, 1])]);

    assert.deepEqual(Array.from(mixed), [0.5, 0]);
  });
});

describe("what fits in one request", () => {
  it("holds the longest recording the button allows", () => {
    const longest = MAX_RECORDING_SECONDS * RECORDING_SAMPLE_RATE;

    assert.ok(maxRecordedSamples() >= longest, `${maxRecordedSamples()} < ${longest}`);
    assert.ok(encodeWav(new Float32Array(longest), RECORDING_SAMPLE_RATE).length <= MAX_AUDIO_BYTES);
  });
});

describe("toBase64", () => {
  it("encodes bytes the way the API reads them back", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252]);

    assert.equal(toBase64(bytes), Buffer.from(bytes).toString("base64"));
  });

  it("survives a megabyte, which one call of btoa does not", () => {
    const bytes = new Uint8Array(1_000_000);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 256;
    }

    assert.equal(toBase64(bytes), Buffer.from(bytes).toString("base64"));
  });
});

describe("formatDuration", () => {
  it("reads like a clock", () => {
    assert.equal(formatDuration(0), "0:00");
    assert.equal(formatDuration(7.4), "0:07");
    assert.equal(formatDuration(95), "1:35");
    assert.equal(formatDuration(-1), "0:00");
  });
});
