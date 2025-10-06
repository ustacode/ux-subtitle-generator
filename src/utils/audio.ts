/**
 * Calculates the RMS (root-mean-square) level of a signed 16-bit PCM buffer.
 * Returns a normalized value between 0 and 1.
 */
export const calculateRmsLevel = (audio: Buffer): number => {
  if (audio.length === 0) return 0;

  const sampleCount = audio.length / 2;
  let sumSquares = 0;

  for (let i = 0; i < audio.length; i += 2) {
    const sample = audio.readInt16LE(i);
    sumSquares += sample * sample;
  }

  const meanSquare = sumSquares / sampleCount;
  const rms = Math.sqrt(meanSquare);
  return rms / 32768;
};
