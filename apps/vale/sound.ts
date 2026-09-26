// Little sounds, made on the spot with WebAudio, so there is nothing to load:
// a thump for a blow, a swish for a miss, a chime for a find, an arpeggio for
// a level. Silent until the player first touches a key or the screen, as
// browsers require, and silent for good once muted.
let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null
let muted = false
try {
  muted = localStorage.getItem('mossvale.quiet') == '1'
} catch { /* a page without storage starts with sound */ }

let wake = () => {
  if (ctx || muted) return
  try {
    ctx = new AudioContext()
    noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate)
    let d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  } catch {
    ctx = null
  }
}
addEventListener('pointerdown', wake, { once: true })
addEventListener('keydown', wake, { once: true })

let out = (gain: number, at: number, dur: number) => {
  let g = ctx!.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  g.connect(ctx!.destination)
  return g
}

let tone = (
  freq: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.12,
  to = freq,
  delay = 0,
) => {
  if (!ctx || muted) return
  let at = ctx.currentTime + delay
  let o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  o.frequency.exponentialRampToValueAtTime(to, at + dur)
  o.connect(out(gain, at, dur))
  o.start(at)
  o.stop(at + dur + 0.02)
}

let hiss = (dur: number, freq: number, gain = 0.1, q = 1) => {
  if (!ctx || !noise || muted) return
  let at = ctx.currentTime
  let s = ctx.createBufferSource()
  s.buffer = noise
  let f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.setValueAtTime(freq, at)
  f.frequency.exponentialRampToValueAtTime(freq * 0.4, at + dur)
  f.Q.value = q
  s.connect(f)
  f.connect(out(gain, at, dur))
  s.start(at)
  s.stop(at + dur + 0.02)
}

export let sound = {
  get muted() {
    return muted
  },
  toggle: () => {
    muted = !muted
    try {
      localStorage.setItem('mossvale.quiet', muted ? '1' : '0')
    } catch { /* kept for this page only */ }
    if (!muted) wake()
    return muted
  },
  hit: (great: boolean) => {
    tone(great ? 180 : 140, 0.16, 'triangle', 0.22, 60)
    hiss(0.12, great ? 2400 : 1600, 0.14, 0.8)
  },
  whiff: () => hiss(0.18, 3000, 0.05, 2),
  hurt: () => tone(220, 0.22, 'square', 0.05, 110),
  pick: () => {
    tone(880, 0.12, 'sine', 0.08)
    tone(1320, 0.18, 'sine', 0.07, 1320, 0.07)
  },
  fall: () => tone(300, 0.4, 'triangle', 0.12, 80),
  level: () =>
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(f, 0.3, 'triangle', 0.09, f, i * 0.09)
    ),
  heal: () => tone(600, 0.3, 'sine', 0.08, 900),
  quest: () =>
    [392, 523, 659].forEach((f, i) => tone(f, 0.25, 'sine', 0.08, f, i * 0.1)),
}
