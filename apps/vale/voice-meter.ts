/** A small oscilloscope trace from a live microphone or incoming voice.
 * Read the actual time-domain samples, not the sender's advertised state. */
export let voiceMeter = (analyser: AnalyserNode) => {
  let samples = new Uint8Array(analyser.fftSize)
  analyser.getByteTimeDomainData(samples)
  let power = 0
  for (let sample of samples) {
    let v = (sample - 128) / 128
    power += v * v
  }
  let talking = Math.sqrt(power / samples.length) > 0.02
  let points: string[] = []
  for (let i = 0; i < 32; i++) {
    // Stagger samples within their buckets so a periodic wave cannot alias
    // into a flat line when its period divides the bucket width.
    let start = Math.floor(i * samples.length / 32)
    let end = Math.max(start + 1, Math.floor((i + 1) * samples.length / 32))
    let offset = (i * 3) % (end - start)
    let v = (samples[start + offset] - 128) / 128
    points.push(`${i * 2},${(8 - v * 7).toFixed(1)}`)
  }
  return { talking, points: points.join(' ') }
}
