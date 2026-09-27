// How each sound in the vale is made: on the spot with Web Audio, so there is
// nothing to load. A thump for a blow, a swish for a miss, a chime for a
// find, the strokes of work at a node, a footstep, a creature's cry, the
// fire and water a level keeps making, and a marsh's frogs. A voice plays
// into whatever node it is given; sound.ts says where that is.

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

/** A fine piece of gear falling to the ground, by its rarity (rarity.ts): a
 * rare one chimes, an epic one rings a run of bells, and a legendary one
 * lands with a boom under a rising run and a long bell over it. */
export let spoils: Record<string, Voice> = {
  rare: voice(0.5, 0.08, (o) => {
    tone(o, 1175, 0.35, 'sine', 0.07)
    tone(o, 1568, 0.4, 'sine', 0.06, 1568, 0.08)
  }),
  epic: voice(
    0.8,
    0.1,
    (o) =>
      [784, 988, 1175, 1568].forEach((f, i) =>
        tone(o, f, 0.45, 'triangle', 0.07, f, i * 0.07)
      ),
  ),
  legendary: voice(1.8, 0.14, (o) => {
    tone(o, 150, 0.9, 'sine', 0.16, 50)
    hiss(o, 0.6, 700, 0.08, 0.7)
    ;[523, 659, 784, 1047, 1319, 1568].forEach((f, i) =>
      tone(o, f, 0.6, 'triangle', 0.08, f, 0.1 + i * 0.08)
    )
    tone(o, 2093, 1.3, 'sine', 0.06, 2093, 0.6)
    tone(o, 3136, 1.1, 'sine', 0.03, 3136, 0.62)
  }),
}

/** A stroke of work, by its trade (trades.ts): an axe biting wood, a pick
 * ringing on stone, leaves pulled, a float plopping; a hammer on the anvil, a
 * plane over a board, a ladle in the cauldron. */
export let stroke: Record<string, Voice> = {
  wood: voice(0.2, 0.14, (o) => {
    tone(o, vary(190), 0.1, 'triangle', 0.16, 90)
    hiss(o, 0.07, 1100, 0.09, 1.2)
  }),
  ore: voice(0.3, 0.12, (o) => {
    tone(o, vary(1900), 0.22, 'sine', 0.05, 1850)
    tone(o, 2870, 0.14, 'sine', 0.035, 2800)
    hiss(o, 0.05, 3800, 0.08, 1.5)
  }),
  herb: voice(0.3, 0.07, (o) => hiss(o, 0.26, vary(2600), 0.07, 0.7)),
  fish: voice(0.35, 0.08, (o) => {
    tone(o, vary(520), 0.12, 'sine', 0.06, 180)
    hiss(o, 0.25, 1400, 0.05, 0.9)
  }),
  forge: voice(0.5, 0.13, (o) => {
    tone(o, vary(1250), 0.4, 'triangle', 0.07, 1240)
    tone(o, 3100, 0.25, 'sine', 0.03, 3080)
    hiss(o, 0.04, 4200, 0.07, 1.5)
  }),
  bench: voice(0.3, 0.09, (o) => {
    hiss(o, 0.2, vary(3200), 0.08, 2.5)
    tone(o, vary(240), 0.06, 'triangle', 0.06, 160, 0.18)
  }),
  cauldron: voice(0.45, 0.08, (o) => {
    tone(o, vary(300), 0.1, 'sine', 0.05, 520)
    tone(o, vary(380), 0.1, 'sine', 0.04, 640, 0.14)
    hiss(o, 0.3, 900, 0.03, 0.6)
  }),
  loom: voice(0.35, 0.07, (o) => {
    tone(o, vary(210), 0.12, 'triangle', 0.04, 170)
    hiss(o, 0.14, 2100, 0.03, 0.5)
  }),
}

/** Work done, by its trade: a tree crashing down, a seam crumbling, a clump
 * pulled up, a fish hauled out with a splash; hot iron quenched, a last tap
 * of the mallet, a brew poured off with a chime. */
export let done: Record<string, Voice> = {
  wood: voice(0.9, 0.2, (o) => {
    tone(o, 320, 0.35, 'sawtooth', 0.03, 260, 0, 900)
    tone(o, 75, 0.6, 'triangle', 0.2, 38, 0.3)
    hiss(o, 0.55, 700, 0.14, 0.6)
  }),
  ore: voice(0.5, 0.14, (o) => {
    hiss(o, 0.45, 900, 0.12, 0.7)
    tone(o, 110, 0.3, 'triangle', 0.1, 60)
  }),
  herb: voice(0.4, 0.08, (o) => {
    hiss(o, 0.35, 2200, 0.08, 0.6)
    tone(o, 660, 0.12, 'sine', 0.04, 880, 0.15)
  }),
  fish: voice(0.6, 0.12, (o) => {
    hiss(o, 0.5, 1800, 0.12, 0.8)
    tone(o, 300, 0.2, 'sine', 0.08, 140)
  }),
  forge: voice(0.9, 0.12, (o) => {
    hiss(o, 0.8, 5200, 0.1, 0.5)
    tone(o, 1250, 0.5, 'triangle', 0.05, 1200)
  }),
  bench: voice(0.5, 0.1, (o) => {
    tone(o, 260, 0.08, 'triangle', 0.08, 170)
    tone(o, 300, 0.08, 'triangle', 0.07, 190, 0.16)
  }),
  cauldron: voice(0.7, 0.1, (o) => {
    hiss(o, 0.4, 1200, 0.05, 0.7)
    for (let [i, f] of [523, 784, 1047].entries()) {
      tone(o, f, 0.3, 'sine', 0.04, f, 0.12 + i * 0.08)
    }
  }),
  loom: voice(0.55, 0.08, (o) => {
    tone(o, 330, 0.17, 'triangle', 0.05, 440)
    tone(o, 660, 0.22, 'sine', 0.04, 880, 0.14)
  }),
}

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

// A buffer `secs` long that loops without a seam, made into `d` by `fill`
// at `rate` samples a second: what it adds past the end comes round to the
// start (`add`), and its noise is filtered the whole way round (`round`).
let seamless = (
  c: BaseAudioContext,
  secs: number,
  fill: (d: Float32Array, rate: number) => void,
  rate = c.sampleRate,
) => {
  let d = new Float32Array(Math.floor(secs * rate))
  fill(d, rate)
  let b = c.createBuffer(1, d.length, rate)
  b.copyToChannel(d, 0)
  return b
}

// `f` of each of `len` samples, added into the loop `d` from sample `at`, and
// round past its end to its start.
let add = (
  d: Float32Array,
  at: number,
  len: number,
  f: (j: number) => number,
) => {
  let n = d.length, from = Math.floor(at)
  for (let j = 0; j < len; j++) d[(from + j) % n] += f(j)
}

// A band that rings, a sample at a time: `x` through a band round `f` Hz, `q`
// sharp, which may move from one sample to the next (a state-variable
// filter, twice over, so what is far from `f` falls away fast); a sound at
// `f` comes through as loud as it went in.
let band = (rate: number) => {
  let a = 0, b = 0, c = 0, e = 0
  return (x: number, f: number, q: number) => {
    let k = 2 * Math.PI * f / rate
    a += k * b
    b += k * (x - a - b / q)
    c += k * e
    e += k * (b / q - c - e / q)
    return e / q
  }
}

// A wait for something that comes when it will, `mean` seconds on average.
let gap = (mean: number) => -Math.log(1 - Math.random()) * mean

// A bubble into `d` at sample `at`: a tone of `f` Hz ringing away over
// `ring` seconds, and rising by `up` of itself each `ring` as it goes.
let bubble = (
  d: Float32Array,
  rate: number,
  at: number,
  f: number,
  ring: number,
  up: number,
  amp: number,
) => {
  let n = ring * rate, fade = Math.exp(-1 / n)
  let w = 2 * Math.PI * f / rate, p = 0
  add(d, at, n * 5, (j) => {
    p += w * (1 + up * j / n)
    return Math.sin(p) * (amp *= fade) * Math.min(1, j / 32)
  })
}

// A lap at the shore into `d` at sample `at`, `amp` loud: a soft slap of
// water, noise through a band that swells in quickly, then the wash running
// back, lower and longer, gurgling a few bubbles as it goes.
let lap = (d: Float32Array, rate: number, at: number, amp: number) => {
  let f = 650 + Math.random() * 650, q = 1 + Math.random()
  let rise = rate * (0.008 + Math.random() * 0.02)
  let slap = rate * (0.02 + Math.random() * 0.03)
  let wash = rate * (0.07 + Math.random() * 0.12)
  let back = 0.2 + Math.random() * 0.3, pass = band(rate)
  let a = (1 - back) * amp * 5, b = back * amp * 5
  let fa = Math.exp(-1 / slap), fb = Math.exp(-1 / wash)
  add(d, at, rise + wash * 3.5, (j) => {
    if (j < rise) return pass(white() * (a + b) * (j / rise) ** 2, f, q)
    return pass(
      white() * ((a *= fa) + (b *= fb)),
      f / (1 + (j - rise) / wash),
      q,
    )
  })
  for (let i = Math.floor(Math.random() * 5); i > 0; i--) {
    let f = 500 + Math.random() * 1300, ring = 0.006 + Math.random() * 0.018
    let when = at + rise + slap + Math.random() * wash * 1.5
    bubble(d, rate, when, f, ring, 0.4, amp * (0.05 + Math.random() * 0.15))
  }
}

// Laps into `d` one after another, `mean` seconds apart on average and
// never nearer than `least`; mostly small, now and then one up to `amp`.
let laps = (
  d: Float32Array,
  rate: number,
  least: number,
  mean: number,
  amp: number,
) => {
  for (let t = gap(mean); t < d.length / rate; t += least + gap(mean)) {
    lap(d, rate, t * rate, amp * (0.25 + Math.random() ** 2 * 0.75))
  }
}

/** A wood fire, to loop: its pops and snaps alone. */
export let fire = (c: BaseAudioContext) =>
  seamless(c, 4, (d, rate) => {
    for (let k = 0; k < 70; k++) {
      let len = rate * (0.001 + Math.random() * 0.012),
        fade = Math.exp(-1 / len)
      let amp = 0.12 + Math.random() ** 4 * 0.8
      add(d, Math.random() * d.length, len * 5, () => white() * (amp *= fade))
    }
  })

// Water holds little above a few thousand hertz, so it is made at half the
// context's rate: half the work and half the memory, played at the context's
// own rate all the same.
let wet = (c: BaseAudioContext) => c.sampleRate / 2

/** The ocean at its shore: the old swelling wash and scattered sprays. */
export let surf = (c: BaseAudioContext) =>
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

/** Still water at its shore, to loop: small soft laps that come when they
 * will, each a slap and a wash back with a bubble or two in it. Little low
 * in it, and no swell. */
export let water = (c: BaseAudioContext) =>
  seamless(c, 12, (d, rate) => laps(d, rate, 0.15, 0.45, 1), wet(c))

/** A marsh, to loop: its still water lapping, softer and seldom, gas
 * bubbling up through the mud a few blubs at a time, and a plop now and
 * then. Its frogs are `croak`. */
export let marsh = (c: BaseAudioContext) =>
  seamless(c, 14, (d, rate) => {
    let secs = d.length / rate
    laps(d, rate, 0.3, 1.1, 0.6)
    for (let t = gap(1.5); t < secs; t += 0.6 + gap(2)) {
      let f = 170 + Math.random() * 230
      for (let i = 2 + Math.random() * 4, s = t; i >= 1; i--) {
        let ring = 0.025 + Math.random() * 0.02
        bubble(d, rate, s * rate, vary(f), ring, 0.5, 0.2)
        s += 0.06 + Math.random() * 0.2
      }
    }
    for (let t = gap(2.5); t < secs; t += 1 + gap(2.5)) {
      let amp = 0.15, fade = Math.exp(-1 / (0.004 * rate))
      add(d, t * rate, 0.02 * rate, () => white() * (amp *= fade))
      bubble(d, rate, t * rate, 350 + Math.random() * 450, 0.035, 1.5, 0.35)
    }
  }, wet(c))

// A buzz: pulses `rate` times a second through the ring of a throat at
// `ring` Hz, from `delay` on, swelling in, held, and let go `dur` seconds
// after it began.
let buzz = (
  o: AudioNode,
  rate: number,
  ring: number,
  dur: number,
  gain: number,
  delay: number,
) => {
  let c = o.context, at = c.currentTime + delay
  let s = new OscillatorNode(c, { type: 'sawtooth', frequency: rate })
  let f = new BiquadFilterNode(c, { type: 'bandpass', frequency: ring, Q: 6 })
  let g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + dur / 4)
  g.gain.setValueAtTime(gain, at + dur * 0.6)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  s.connect(f).connect(g).connect(o)
  s.start(at)
  s.stop(at + dur + 0.02)
}

/** A frog in a marsh: two or three croaks, each a rasp of pulses through
 * the ring of its throat, the last a little lower; now and then a smaller
 * frog, higher and quicker. */
export let croak = () => {
  let small = Math.random() < 0.3
  let ring = vary(small ? 1300 : 650), rate = vary(small ? 70 : 45)
  let n = 2 + Math.floor(Math.random() * 2), dur = small ? 0.09 : 0.16
  return voice(n * (dur + 0.08) + 0.1, 0.08, (o) => {
    for (let i = 0; i < n; i++) {
      let low = i == n - 1 ? 0.9 : 1
      buzz(o, rate * low, ring * low, dur, 0.5, i * (dur + 0.08))
    }
  })
}
