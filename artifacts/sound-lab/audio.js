import {
  advance,
  audible,
  clamp,
  duration,
  frequency,
  position,
  sequence,
  tracks,
} from './music.js'

let targets = new WeakMap()
let parameter = (value, target, time, smooth = true) => {
  if (targets.get(value) === target) return
  targets.set(value, target)
  value.cancelScheduledValues(time)
  if (smooth) value.setTargetAtTime(target, time, 0.012)
  else value.setValueAtTime(target, time)
}
let noiseBuffers = new WeakMap()
let noise = (context) => {
  if (noiseBuffers.has(context)) return noiseBuffers.get(context)
  let buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
  let data = buffer.getChannelData(0)
  let seed = 12345
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 16807) % 2147483647
    data[i] = seed / 1073741824 - 1
  }
  noiseBuffers.set(context, buffer)
  return buffer
}

let routing = (context, song) => {
  let master = context.createGain()
  let limiter = context.createDynamicsCompressor()
  let analyzer = context.createAnalyser()
  let delay = context.createDelay(2)
  let feedback = context.createGain()
  let wet = context.createGain()
  analyzer.fftSize = 2048
  analyzer.smoothingTimeConstant = 0.72
  limiter.threshold.value = -8
  limiter.knee.value = 8
  limiter.ratio.value = 12
  limiter.attack.value = 0.003
  limiter.release.value = 0.15
  master.connect(limiter).connect(analyzer).connect(context.destination)
  delay.connect(feedback).connect(delay)
  delay.connect(wet).connect(master)
  feedback.gain.value = 0.28
  let channels = tracks.map((_, index) => {
    let filter = context.createBiquadFilter()
    let pan = context.createStereoPanner()
    let gain = context.createGain()
    filter.type = 'lowpass'
    filter.Q.value = 0.5
    filter.connect(pan).connect(gain).connect(master)
    if (index >= 5) gain.connect(delay)
    return { filter, pan, gain }
  })
  let mix = (song, smooth = true) => {
    let time = context.currentTime
    let set = (value, target) => parameter(value, target, time, smooth)
    set(master.gain, clamp(song.master) * 0.62)
    set(wet.gain, clamp(song.delay) * 0.65)
    set(delay.delayTime, 60 / clamp(song.bpm, 40, 240) * 0.75)
    channels.forEach((channel, i) => {
      let settings = song.mix[i]
      set(channel.gain.gain, audible(song.mix, i) ? clamp(settings.volume) : 0)
      set(channel.pan.pan, clamp(settings.pan, -1, 1))
      set(channel.filter.frequency, 250 * 64 ** clamp(settings.tone))
    })
  }
  mix(song, false)
  return {
    channels,
    analyzer,
    mix,
    silence: () => {
      master.gain.cancelScheduledValues(context.currentTime)
      master.gain.setValueAtTime(0, context.currentTime)
      feedback.gain.value = 0
    },
    dispose: () => {
      for (let channel of channels) {
        Object.values(channel).forEach((node) => node.disconnect())
      }
      ;[master, limiter, analyzer, delay, feedback, wet].forEach((node) =>
        node.disconnect()
      )
    },
  }
}

let envelope = (context, destination, time, length, volume, attack = 0.003) => {
  let gain = context.createGain()
  gain.gain.setValueAtTime(0, time)
  gain.gain.linearRampToValueAtTime(volume, time + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + length)
  gain.gain.linearRampToValueAtTime(0, time + length + 0.008)
  gain.connect(destination)
  return gain
}

let voice = (active, source, output, time, length, extras = []) => {
  source.connect(output)
  active.add(source)
  source.onended = () => {
    active.delete(source)
    source.disconnect()
    output.disconnect()
    extras.forEach((node) => node.disconnect())
  }
  source.start(time)
  source.stop(time + length + 0.01)
}

let oscillator = (context, active, destination, time, settings) => {
  let { pitch, end = pitch, length, volume, type = 'sine', attack = 0.003 } =
    settings
  let source = context.createOscillator()
  source.type = type
  source.frequency.setValueAtTime(pitch, time)
  if (end !== pitch) {
    source.frequency.exponentialRampToValueAtTime(end, time + length * 0.7)
  }
  let gain = envelope(context, destination, time, length, volume, attack)
  voice(active, source, gain, time, length)
}

let hiss = (
  context,
  active,
  destination,
  time,
  length,
  volume,
  pitch,
  type = 'highpass',
) => {
  let source = context.createBufferSource()
  let filter = context.createBiquadFilter()
  let gain = envelope(context, destination, time, length, volume)
  source.buffer = noise(context)
  filter.type = type
  filter.frequency.value = pitch
  filter.Q.value = 0.8
  filter.connect(gain)
  voice(active, source, filter, time, length, [gain])
}

let hit = (
  context,
  active,
  destination,
  id,
  time,
  note = 48,
  velocity = 0.8,
) => {
  let volume = clamp(velocity)
  let tone = (settings, offset = 0) =>
    oscillator(context, active, destination, time + offset, settings)
  let air = (length, gain, pitch, type, offset = 0) =>
    hiss(
      context,
      active,
      destination,
      time + offset,
      length,
      gain * volume,
      pitch,
      type,
    )
  if (id === 'kick') {
    tone({ pitch: 145, end: 43, length: 0.42, volume: volume * 0.95 })
    tone({ pitch: 900, end: 120, length: 0.025, volume: volume * 0.12 })
  } else if (id === 'snare') {
    tone({
      pitch: 190,
      end: 120,
      length: 0.12,
      volume: volume * 0.35,
      type: 'triangle',
    })
    air(0.18, 0.45, 1800, 'highpass')
  } else if (id === 'hat' || id === 'open') {
    air(id === 'hat' ? 0.045 : 0.28, 0.3, 6500, 'highpass')
  } else if (id === 'clap') {
    for (let offset of [0, 0.012, 0.025]) {
      air(0.06, 0.25, 1200, 'bandpass', offset)
    }
    air(0.18, 0.3, 1600, 'bandpass', 0.035)
  } else if (id === 'perc') {
    tone({
      pitch: frequency(note) * 1.6,
      end: frequency(note),
      length: 0.16,
      volume: volume * 0.5,
    })
  } else if (id === 'bass') {
    tone({
      pitch: frequency(note),
      length: 0.27,
      volume: volume * 0.42,
      type: 'triangle',
    })
    tone({ pitch: frequency(note) / 2, length: 0.3, volume: volume * 0.2 })
  } else if (id === 'keys') {
    for (let [semitones, gain] of [[0, 0.24], [7, 0.08], [12, 0.1]]) {
      tone({
        pitch: frequency(note + semitones),
        length: 0.65,
        volume: volume * gain,
        attack: 0.008,
      })
    }
  }
}

let playStep = (context, bus, active, song, cursor) => {
  let pattern = song.patterns[cursor.pattern]
  tracks.forEach((track, index) => {
    let step = pattern.steps[index][cursor.step]
    if (step && audible(song.mix, index)) {
      hit(
        context,
        active,
        bus.channels[index].filter,
        track.id,
        cursor.time,
        step.note,
        step.velocity,
      )
    }
  })
}

export let engine = ({
  getSong,
  onStep = (_event) => {},
  createContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  every = (callback) => setInterval(callback, 25),
  cancel = (timer) => clearInterval(timer),
}) => {
  let context, bus, timer, cursor, running = false, starting = null
  let active = new Set()
  let ready = async () => {
    context ||= createContext()
    await context.resume()
    bus ||= routing(context, getSong())
  }
  let tick = () => {
    if (!running) return
    let song = getSong()
    bus.mix(song)
    if (cursor.time < context.currentTime - 0.05) {
      cursor.time = context.currentTime + 0.02
    }
    let count = 0
    while (cursor.time < context.currentTime + 0.12 && count++ < 32) {
      cursor = position(song, cursor)
      if (cursor.step >= song.patterns[cursor.pattern].length) cursor.step = 0
      playStep(context, bus, active, song, cursor)
      onStep({ ...cursor })
      cursor = advance(song, cursor)
    }
  }
  let stop = () => {
    running = false
    if (timer !== undefined) cancel(timer)
    timer = undefined
    for (let source of active) source.stop(context.currentTime)
    active.clear()
    if (bus) {
      bus.silence()
      bus.dispose()
      bus = null
    }
  }
  let generation = 0
  return {
    start: () => {
      if (running) return Promise.resolve()
      if (starting) return starting
      let request = generation
      let pending = ready().then(() => {
        if (generation !== request) return
        running = true
        cursor = {
          pattern: getSong().pattern,
          chain: 0,
          step: 0,
          time: context.currentTime + 0.04,
        }
        tick()
        timer = every(tick)
      }).finally(() => {
        if (starting === pending) starting = null
      })
      starting = pending
      return pending
    },
    stop: () => {
      generation++
      starting = null
      stop()
    },
    preview: async (track, note, velocity = 0.8) => {
      let request = generation
      await ready()
      if (generation !== request) return
      let index = typeof track === 'number'
        ? track
        : tracks.findIndex((value) => value.id === track)
      if (index < 0 || index >= tracks.length) return
      bus.mix(getSong())
      hit(
        context,
        active,
        bus.channels[index].filter,
        tracks[index].id,
        context.currentTime + 0.005,
        note ?? (index === 6 ? 38 : 62),
        velocity,
      )
    },
    setMix: () => bus?.mix(getSong()),
    analyzer: () => bus?.analyzer || null,
    context: () => context || null,
    get playing() {
      return running
    },
  }
}

export let render = async (song, options = {}) => {
  let seconds = duration(song, options) + 2
  let create = options.createContext ||
    ((channels, frames, rate) =>
      new OfflineAudioContext(channels, frames, rate))
  let context = create(2, Math.ceil(seconds * 44100), 44100)
  let bus = routing(context, song)
  let active = new Set()
  for (let cursor of sequence(song, options)) {
    playStep(context, bus, active, song, cursor)
  }
  return await context.startRendering()
}

export let wav = (buffer) => {
  let channels = buffer.numberOfChannels
  let bytes = buffer.length * channels * 2
  let data = new ArrayBuffer(44 + bytes)
  let view = new DataView(data)
  let text = (offset, text) =>
    [...text].forEach((letter, i) =>
      view.setUint8(offset + i, letter.charCodeAt(0))
    )
  text(0, 'RIFF')
  view.setUint32(4, 36 + bytes, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, bytes, true)
  let samples = Array.from(
    { length: channels },
    (_, i) => buffer.getChannelData(i),
  )
  for (let frame = 0; frame < buffer.length; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      let value = clamp(samples[channel][frame], -1, 1)
      view.setInt16(
        44 + (frame * channels + channel) * 2,
        Math.round(value * (value < 0 ? 32768 : 32767)),
        true,
      )
    }
  }
  return data
}
