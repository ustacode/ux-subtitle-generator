export interface PcmToWavOptions {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
}

/**
 * Wraps a raw PCM s16le buffer into a WAV container.
 */
export const pcm16leToWav = (
  pcm: Buffer,
  { sampleRate = 16_000, channels = 1, bitsPerSample = 16 }: PcmToWavOptions = {}
): Buffer => {
  const headerSize = 44;
  const wav = Buffer.allocUnsafe(headerSize + pcm.length);

  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;

  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVE", 8);

  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);

  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);

  pcm.copy(wav, headerSize);
  return wav;
};

export interface SilenceFilterOptions {
  sampleRate?: number;
  frameMs?: number;
  threshold?: number;
  paddingMs?: number;
}

/**
 * Removes low-energy frames (background noise) from a PCM s16le buffer.
 * Returns an empty buffer when the entire chunk is silence.
 */
export const filterSilence = (
  pcm: Buffer,
  {
    sampleRate = 16_000,
    frameMs = 20,
    threshold = 0.015,
    paddingMs = 80,
  }: SilenceFilterOptions = {}
): Buffer => {
  if (pcm.length === 0) return pcm;

  const samples = pcm.length / 2;
  const frameSamples = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const paddingSamples = Math.round((sampleRate * paddingMs) / 1000);

  const view = new Int16Array(pcm.buffer, pcm.byteOffset, samples);
  const keepMask = new Uint8Array(samples);

  for (let start = 0; start < samples; start += frameSamples) {
    const size = Math.min(frameSamples, samples - start);
    let sumSquares = 0;
    for (let i = 0; i < size; i++) {
      const sample = view[start + i];
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / size) / 32768;
    if (rms >= threshold) {
      const keepStart = Math.max(0, start - paddingSamples);
      const keepEnd = Math.min(samples, start + size + paddingSamples);
      keepMask.fill(1, keepStart, keepEnd);
    }
  }

  let keepCount = 0;
  for (let i = 0; i < samples; i++) {
    if (keepMask[i]) keepCount += 1;
  }

  if (keepCount === 0) {
    return Buffer.alloc(0);
  }

  const filtered = Buffer.allocUnsafe(keepCount * 2);
  let offset = 0;
  for (let i = 0; i < samples; i++) {
    if (!keepMask[i]) continue;
    filtered.writeInt16LE(view[i], offset);
    offset += 2;
  }

  return filtered;
};
