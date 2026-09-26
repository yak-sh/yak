// How each sound in the vale is made: on the spot with Web Audio, so there is
// nothing to load. A thump for a blow, a swish for a miss, a chime for a
// find, a footstep, a creature's cry, and the fire and water a level keeps
// making. A voice plays into whatever node it is given; sound.ts says where
// that is.

/** A sound: how long it lasts in seconds, how loud it is at its source, and
 * how it is made into `o`. */
export type Voice = { dur: number; loud: number; play: (o: AudioNode) => void }

let voice = (dur: number, loud: number, play: Voice['play']): Voice => ({
  dur,
  loud,
  play,
})
let white = () => Math.random() * 2 - 1
let vary = (x: number) => x * (0.85 + Math.random() * 0.3)

// A second of white noise for each context, to filter into hisses.
let buffers = new WeakMap<BaseAudioContext, AudioBuffer>()
let noiseOf = (c: BaseAudioContext) => {
  let b = buffers.get(c)
  if (b) return b
  b = c.createBuffer(1, c.sampleRate, c.sampleRate)
  let d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = white()
  buffers.set(c, b)
  return b
}

let env = (o: AudioNode, gain: number, at: number, dur: number) => {
  let g = o.context.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  g.connect(o)
  return g
}

// A tone sliding from `freq` to `to`, through a lowpass at `low` if given.
let tone = (
  o: AudioNode,
  freq: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.12,
  to = freq,
  delay = 0,
  low = 0,
) => {
  let c = o.context, at = c.currentTime + delay
  let s = c.createOscillator()
  s.type = type
  s.frequency.setValueAtTime(freq, at)
  s.frequency.exponentialRampToValueAtTime(to, at + dur)
  let e = env(o, gain, at, dur)
  if (low) s.connect(new BiquadFilterNode(c, { frequency: low })).connect(e)
  else s.connect(e)
  s.start(at)
  s.stop(at + dur + 0.02)
}

// Noise through a band that falls as it fades.
let hiss = (o: AudioNode, dur: number, freq: number, gain = 0.1, q = 1) => {
  let c = o.context, at = c.currentTime
  let s = c.createBufferSource()
  s.buffer = noiseOf(c)
  let f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.setValueAtTime(freq, at)
  f.frequency.exponentialRampToValueAtTime(freq * 0.4, at + dur)
  f.Q.value = q
  s.connect(f)
  f.connect(env(o, gain, at, dur))
  s.start(at, Math.random() * 0.4)
  s.stop(at + dur + 0.02)
}

export let hit = (great: boolean) =>
  voice(0.2, 0.22, (o) => {
    tone(o, great ? 180 : 140, 0.16, 'triangle', 0.22, 60)
    hiss(o, 0.12, great ? 2400 : 1600, 0.14, 0.8)
  })
/** Another player's blow landing: a little softer than your own. */
export let struck = voice(0.2, 0.16, (o) => {
  tone(o, 150, 0.14, 'triangle', 0.16, 60)
  hiss(o, 0.1, 1800, 0.1, 0.8)
})
export let whiff = voice(0.2, 0.05, (o) => hiss(o, 0.18, 3000, 0.05, 2))
export let roll = voice(0.3, 0.07, (o) => hiss(o, 0.3, 900, 0.07, 1.5))
export let dodge = voice(0.2, 0.07, (o) => {
  hiss(o, 0.2, 4200, 0.05, 3)
  tone(o, 990, 0.16, 'sine', 0.07, 1480)
})
export let hurt = voice(
  0.25,
  0.05,
  (o) => tone(o, 220, 0.22, 'square', 0.05, 110),
)
export let pick = voice(0.3, 0.08, (o) => {
  tone(o, 880, 0.12, 'sine', 0.08)
  tone(o, 1320, 0.18, 'sine', 0.07, 1320, 0.07)
})
export let fall = voice(
  0.4,
  0.12,
  (o) => tone(o, 300, 0.4, 'triangle', 0.12, 80),
)
export let heal = voice(0.3, 0.08, (o) => tone(o, 600, 0.3, 'sine', 0.08, 900))
export let level = voice(
  0.6,
  0.09,
  (o) =>
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(o, f, 0.3, 'triangle', 0.09, f, i * 0.09)
    ),
)
export let quest = voice(
  0.5,
  0.08,
  (o) =>
    [392, 523, 659].forEach((f, i) =>
      tone(o, f, 0.25, 'sine', 0.08, f, i * 0.1)
    ),
)

// A footstep by body plan, for a creature `s` times the square root of its
// size: soft for a hero, heavier and lower the bigger the creature, a
// squelch for a slime and a knock of stone for a crag.
let STEPS: Record<string, (s: number) => Voice> = {
  slime: (s) =>
    voice(0.12, 0.05, (o) => {
      tone(o, vary(300 / s ** 2), 0.1, 'sine', 0.05, 120 / s ** 2)
      hiss(o, 0.06, 1400, 0.02, 1)
    }),
  crag: (s) =>
    voice(0.2, 0.1, (o) => {
      tone(o, vary(70), 0.18, 'triangle', 0.06 * s, 38)
      hiss(o, 0.1, 500, 0.05, 0.8)
    }),
  hero: () => voice(0.1, 0.035, (o) => hiss(o, 0.07, vary(1000), 0.035)),
  _: (s) =>
    voice(0.12, 0.035 * s, (o) => {
      hiss(o, 0.05 + 0.03 * s, vary(800 / s), 0.035 * s)
      if (s > 1.2) tone(o, vary(90 / s), 0.12, 'triangle', 0.04 * s, 45)
    }),
}
export let step = (plan: string, size: number) =>
  (STEPS[plan] ?? STEPS._)(Math.sqrt(size))

// A creature's cry by body plan: at full voice `k` of 1 for a growl as its
// bite winds up, less for a call, and `low` lower for a bigger creature.
let CRIES: Record<string, (k: number, low: number) => Voice> = {
  bird: (k, low) =>
    voice(0.3, 0.06 * k, (o) => {
      tone(o, vary(2600 * low), 0.08, 'sine', 0.06 * k, 3400 * low)
      tone(o, 2300 * low, 0.1, 'sine', 0.05 * k, 3100 * low, 0.12)
    }),
  slime: (k, low) =>
    voice(
      0.35,
      0.07 * k,
      (o) => tone(o, vary(260 * low), 0.3, 'sine', 0.07 * k, 110 * low),
    ),
  wisp: (k) =>
    voice(
      0.5,
      0.04 * k,
      (o) => tone(o, vary(900), 0.45, 'sine', 0.04 * k, 1500),
    ),
  serpent: (k) =>
    voice(0.6, 0.06 * k, (o) => hiss(o, 0.55, 5200, 0.06 * k, 1.2)),
  flier: (k, low) =>
    voice(0.4, 0.03 * k, (o) => {
      let f = vary(240 * low)
      tone(o, f, 0.35, 'sawtooth', 0.03 * k, f * 0.9, 0, 1800)
    }),
  crag: (k) =>
    voice(0.6, 0.08 * k, (o) => {
      tone(o, vary(55), 0.55, 'sawtooth', 0.06 * k, 38, 0, 400)
      hiss(o, 0.45, 350, 0.05 * k, 0.7)
    }),
  // A growl: the beasts, the bipeds, the crawlers and hoppers.
  _: (k, low) =>
    voice(0.5, 0.08 * k, (o) => {
      let f = vary(150 * low), dur = 0.45 * k
      tone(o, f, dur, 'sawtooth', 0.08 * k, f * 0.6, 0, 700)
      tone(o, f * 1.02, dur * 0.9, 'square', 0.03 * k, f * 0.55, 0, 500)
    }),
}
export let cry = (plan: string, size: number, loud: boolean) =>
  (CRIES[plan] ?? CRIES._)(loud ? 1 : 0.55, 1 / Math.sqrt(size))

// A buffer `secs` long that loops without a seam: filled a little long, and
// its end faded into its start.
let seamless = (
  c: BaseAudioContext,
  secs: number,
  fill: (d: Float32Array, rate: number) => void,
) => {
  let rate = c.sampleRate, n = Math.floor(secs * rate), x = rate >> 2
  let d = new Float32Array(n + x)
  fill(d, rate)
  for (let i = 0; i < x; i++) d[i] = d[i] * (i / x) + d[n + i] * (1 - i / x)
  let b = c.createBuffer(1, n, rate)
  b.copyToChannel(d.subarray(0, n), 0)
  return b
}

/** A fire, to loop: a low roar, and pops and snaps. */
export let fire = (c: BaseAudioContext) =>
  seamless(c, 4, (d, rate) => {
    let low = 0
    for (let i = 0; i < d.length; i++) {
      low += (white() - low) * 0.03
      d[i] = low
    }
    for (let k = 0; k < 70; k++) {
      let at = Math.floor(Math.random() * (d.length - rate / 8))
      let len = rate * (0.001 + Math.random() * 0.012)
      let amp = 0.12 + Math.random() ** 4 * 0.8
      for (let j = 0; j < len * 5; j++) {
        d[at + j] += white() * amp * Math.exp(-j / len)
      }
    }
  })

/** Water lapping at a shore, to loop: a low wash that swells and falls, and
 * a drip now and then. */
export let water = (c: BaseAudioContext) =>
  seamless(c, 8, (d, rate) => {
    let b = 0
    for (let i = 0; i < d.length; i++) {
      let t = i / rate
      b = (b + 0.02 * white()) / 1.02
      d[i] = b * 3 *
        (0.6 + 0.25 * Math.sin(t * Math.PI / 2) +
          0.15 * Math.sin(t * Math.PI * 1.25 + 1))
    }
    for (let k = 0; k < 10; k++) {
      let at = Math.floor(Math.random() * (d.length - rate / 4))
      let f = 500 + Math.random() * 900
      for (let j = 0; j < rate / 8; j++) {
        let t = j / rate
        d[at + j] += Math.sin(Math.PI * 2 * f * t * (1 + t * 8)) * 0.1 *
          Math.exp(-t * 40)
      }
    }
  })
