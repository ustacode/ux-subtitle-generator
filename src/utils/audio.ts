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
