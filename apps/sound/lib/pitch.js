const NOTE_NAMES = [
  'C',
  'C♯',
  'D',
  'D♯',
  'E',
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'A♯',
  'B',
]
const MIN_HZ = 50
const MAX_HZ = 2200
const MIN_RMS = 0.002
const MAX_DIFFERENCE = 0.12

export function createPitchDetector(sampleRate) {
  // Box-average to about 12 kHz before measuring periods. Reuse the scratch
  // buffers; note analysis runs independently of the display's FFT settings.
  const stride = Math.max(1, Math.round(sampleRate / 12000))
  const rate = sampleRate / stride
  const minLag = Math.max(2, Math.floor(rate / MAX_HZ))
  const maxLag = Math.ceil(rate / MIN_HZ) + 1
  const windowSize = Math.ceil(rate * 0.025)
  const wave = new Float32Array(windowSize + maxLag)
  const difference = new Float32Array(maxLag + 1)

  return (samples) => {
    const start = samples.length - wave.length * stride
    if (start < 0) return null
    let sum = 0
    let squares = 0
    for (let i = 0; i < wave.length; i++) {
      let avg = 0
      for (let j = 0; j < stride; j++) avg += samples[start + i * stride + j]
      wave[i] = avg /= stride
      sum += avg
      squares += avg * avg
    }
    const mean = sum / wave.length
    if (squares / wave.length - mean * mean < MIN_RMS ** 2) return null

    // YIN: prefer the first pronounced period, not the strongest harmonic.
    difference[0] = 1
    let running = 0
    for (let lag = 1; lag <= maxLag; lag++) {
      let total = 0
      for (let i = 0; i < windowSize; i++) {
        const delta = wave[i] - wave[i + lag]
        total += delta * delta
      }
      running += total
      difference[lag] = running ? total * lag / running : 1
    }
    for (let lag = minLag; lag < maxLag; lag++) {
      const left = difference[lag - 1],
        mid = difference[lag],
        right = difference[lag + 1]
      if (mid >= MAX_DIFFERENCE || mid > left || mid >= right) continue
      const refined = lag + (left - right) / (2 * (left - 2 * mid + right))
      const hz = rate / refined
      if (hz < MIN_HZ || hz > MAX_HZ) return null
      return Math.round(69 + 12 * Math.log2(hz / 440))
    }
    return null
  }
}

export function noteName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1)
}
