import { equal, ok, test } from '@yaks/testing'
import { engine, wav } from './audio.js'
import { song } from './music.js'

let parameter = () => ({
  value: 0,
  setTargetAtTime() {},
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
  cancelScheduledValues() {},
})

let context = () => {
  let sources: { starts: number[]; stops: number[] }[] = []
  let node = () => ({
    gain: parameter(),
    frequency: parameter(),
    Q: parameter(),
    pan: parameter(),
    threshold: parameter(),
    knee: parameter(),
    ratio: parameter(),
    attack: parameter(),
    release: parameter(),
    delayTime: parameter(),
    connect(next: unknown) {
      return next
    },
    disconnect() {},
  })
  let source = () => {
    let starts: number[] = [], stops: number[] = []
    let value = {
      ...node(),
      starts,
      stops,
      start: (time: number) => starts.push(time),
      stop: (time: number) => stops.push(time),
    }
    sources.push(value)
    return value
  }
  return {
    sources,
    currentTime: 0,
    sampleRate: 100,
    destination: node(),
    resume: () => Promise.resolve(),
    createGain: node,
    createBiquadFilter: node,
    createStereoPanner: node,
    createDynamicsCompressor: node,
    createAnalyser: node,
    createDelay: node,
    createOscillator: source,
    createBufferSource: source,
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
  }
}

let fixture = () => {
  let audio = context(),
    value = song(),
    events: { time: number; step: number }[] = []
  let tick = () => {}, cancelled = false
  let player = engine({
    getSong: () => value,
    createContext: () => audio as unknown as AudioContext,
    onStep: (event: { time: number; step: number }) => events.push(event),
    every: (callback: () => void) => {
      tick = callback
      return 1
    },
    cancel: () => {
      cancelled = true
    },
  })
  return {
    audio,
    value,
    events,
    player,
    tick: () => tick(),
    cancelled: () => cancelled,
  }
}

let scheduled = fixture(),
  stalled = fixture(),
  stopped = fixture(),
  pending = fixture(),
  restarting = fixture()

test('sound lab schedules ahead of the audio clock without repeating steps', async () => {
  await scheduled.player.start()
  equal(scheduled.events.map((event) => event.step), [0])
  scheduled.tick()
  equal(scheduled.events.length, 1)
  scheduled.audio.currentTime = 0.08
  scheduled.tick()
  equal(scheduled.events.map((event) => event.step), [0, 1])
  ok(scheduled.events[1].time > scheduled.audio.currentTime)
  scheduled.player.stop()
})

test('sound lab recovers a late timer without playing a backlog', async () => {
  await stalled.player.start()
  stalled.audio.currentTime = 100
  stalled.tick()
  let late = stalled.events.slice(1)
  ok(late.length <= 2)
  ok(late.every((event) => event.time >= 100))
  stalled.player.stop()
})

test('sound lab stop cancels future voices and its scheduler', async () => {
  await stopped.player.start()
  ok(stopped.audio.sources.length > 0)
  stopped.player.stop()
  ok(stopped.cancelled())
  equal(stopped.player.playing, false)
  ok(stopped.audio.sources.every((source) => source.stops.at(-1) === 0))
  let count = stopped.events.length
  stopped.tick()
  equal(stopped.events.length, count)
})

test('sound lab stop during audio activation prevents delayed playback', async () => {
  let start = pending.player.start()
  pending.player.stop()
  await start
  equal(pending.player.playing, false)
  equal(pending.events.length, 0)
})

test('sound lab can restart while audio activation is pending', async () => {
  let first = restarting.player.start()
  restarting.player.stop()
  let second = restarting.player.start()
  await Promise.all([first, second])
  equal(restarting.player.playing, true)
  equal(restarting.events.length, 1)
  restarting.player.stop()
})

test('sound lab WAV interleaves stereo and clips PCM without wrapping', () => {
  let samples = [new Float32Array([-2, 0.5]), new Float32Array([2, -0.5])]
  let result = wav({
    numberOfChannels: 2,
    length: 2,
    sampleRate: 44100,
    getChannelData: (channel: number) => samples[channel],
  })
  let view = new DataView(result)
  equal(new TextDecoder().decode(result.slice(0, 4)), 'RIFF')
  equal(view.getUint32(4, true), 44)
  equal(view.getUint16(22, true), 2)
  equal(view.getUint32(40, true), 8)
  equal([44, 46, 48, 50].map((offset) => view.getInt16(offset, true)), [
    -32768,
    32767,
    16384,
    -16384,
  ])
})
