// The machine's sounds, made on the spot with Web Audio: nothing is
// downloaded. Off until the reader turns them on; each sound is a function
// that does nothing while they are off.
//
// A drive's sounds are mechanical: the disk clacking home, the head stepper
// ticking across tracks while the spindle hums, the spring throwing the disk
// out. A tube's are electrical: the thunk and whine of the high voltage
// coming up, and the degaussing coil's long hum.

let on = false
let ctx

let audio = () => ctx ??= new AudioContext()

/** Whether sounds play. */
export let sounding = () => on

/** Turn sounds on or off. The first turn-on is a click, which is what lets a
 * page start audio at all. */
export let sound = (yes) => {
  on = yes
  if (yes) audio().resume()
}

// A short burst of noise, shaped by a filter: the stuff clicks and clacks are
// made of.
let noise = (seconds) => {
  let c = audio()
  let buffer = c.createBuffer(
    1,
    Math.ceil(c.sampleRate * seconds),
    c.sampleRate,
  )
  let data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  let source = c.createBufferSource()
  source.buffer = buffer
  return source
}

// One strike: noise through a band-pass, at `at` seconds from now.
let tick = (at, { freq = 1800, q = 3, gain = .25, length = .012 } = {}) => {
  let c = audio()
  let src = noise(length)
  let band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = freq
  band.Q.value = q
  let amp = c.createGain()
  let t = c.currentTime + at
  amp.gain.setValueAtTime(gain, t)
  amp.gain.exponentialRampToValueAtTime(.001, t + length)
  src.connect(band).connect(amp).connect(c.destination)
  src.start(t)
}

// A tone that swells and dies: hum, whine, thunk.
let tone = (
  at,
  { freq, to = freq, type = 'sine', gain = .1, attack = .01, length = .3 },
) => {
  let c = audio()
  let osc = c.createOscillator()
  let amp = c.createGain()
  let t = c.currentTime + at
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + length)
  amp.gain.setValueAtTime(.0001, t)
  amp.gain.exponentialRampToValueAtTime(gain, t + attack)
  amp.gain.exponentialRampToValueAtTime(.0001, t + length)
  osc.connect(amp).connect(c.destination)
  osc.start(t)
  osc.stop(t + length + .05)
}

let when = (fn) => (...args) => on && fn(...args)

/** The disk seating in the drive, and the shutter pulled open. */
export let clack = when(() => {
  tick(0, { freq: 900, q: 1.2, gain: .5, length: .035 })
  tick(.045, { freq: 2600, q: 4, gain: .22, length: .02 })
  tone(0, { freq: 110, to: 60, gain: .18, length: .09 })
})

/** The head seeking, `steps` ticks of the stepper, and the spindle turning
 * for `seconds`. */
export let seek = when((steps = 14, seconds = 1) => {
  let t = .02
  for (let i = 0; i < steps; i++) {
    tick(t, { freq: 1400 + Math.random() * 500, q: 6, gain: .16, length: .01 })
    tone(t, { freq: 420, to: 380, type: 'square', gain: .012, length: .018 })
    t += .018 + Math.random() * .03 + (i % 5 == 4 ? .09 : 0)
  }
  tone(0, {
    freq: 62,
    to: 58,
    type: 'sawtooth',
    gain: .018,
    attack: .15,
    length: seconds,
  })
})

/** The spring throwing the disk out. */
export let spring = when(() => {
  tick(0, { freq: 700, q: 1.5, gain: .45, length: .05 })
  tone(0, { freq: 240, to: 90, type: 'triangle', gain: .12, length: .12 })
  tick(.11, { freq: 2200, q: 3, gain: .15, length: .02 })
})

/** The high voltage coming up: a thunk, and the flyback's whine. */
export let thunk = when(() => {
  tone(0, { freq: 70, to: 40, gain: .35, length: .25 })
  tick(0, { freq: 300, q: .8, gain: .3, length: .06 })
  tone(.05, { freq: 15600, gain: .006, attack: .3, length: 1.8 })
})

/** The degaussing coil: a deep hum that swells and dies away. */
export let degauss = when(() => {
  tick(0, { freq: 500, q: 1, gain: .35, length: .04 })
  tone(0, {
    freq: 60,
    to: 58,
    type: 'sawtooth',
    gain: .12,
    attack: .04,
    length: 1.3,
  })
  tone(0, { freq: 120, to: 116, gain: .06, attack: .04, length: 1.1 })
})

/** A key, as the example types itself. */
export let key = when(() =>
  tick(0, { freq: 3000 + Math.random() * 1500, q: 2, gain: .05, length: .008 })
)
