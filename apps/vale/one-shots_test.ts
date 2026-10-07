// One-shots start with the event and replace repeats from the same source.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { oneShots, recorded, type Voice } from './voices.ts'

let clip = (...channels: number[][]) =>
  ({
    numberOfChannels: channels.length,
    sampleRate: 1000,
    length: channels[0].length,
    getChannelData: (ch: number) => new Float32Array(channels[ch]),
  }) as AudioBuffer

let audio = () => {
  let gates: { connected: boolean }[] = []
  let ctx = {
    currentTime: 5,
    createGain: () => {
      let gate = {
        context: ctx,
        connected: false,
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect: (_: unknown) => {
          gate.connected = true
          return gate
        },
        disconnect: () => {
          gate.connected = false
        },
      }
      gates.push(gate)
      return gate
    },
  }
  return { ctx, gates, into: { context: ctx } as unknown as AudioNode }
}

let quiet: Voice = { dur: 0.1, loud: 0.035, play() {} }

test('a generated step plays from its onset for one step, excluding later taps', () => {
  let { into, ctx } = audio()
  let starts: number[][] = []
  let original = Object.getOwnPropertyDescriptor(
    globalThis,
    'AudioBufferSourceNode',
  )
  Object.defineProperty(globalThis, 'AudioBufferSourceNode', {
    configurable: true,
    value: class {
      connect(g: unknown) {
        return g
      }
      disconnect() {}
      start(...args: number[]) {
        starts.push(args)
      }
      stop() {}
    },
  })
  try {
    // Silence in every channel; a quiet attack in the right channel, then
    // another tap 120 ms later and a long silent tail.
    let left = Array(2530).fill(0), right = [...left]
    right.fill(0.25, 920, 950)
    left.fill(0.5, 1040, 1070)
    let voice = recorded(clip(left, right), quiet, 0.25, 'step')
    voice.play(into)
    assertEquals(starts, [[ctx.currentTime, 0.92, 0.1]])
    assertEquals(voice.dur, 0.1)
    // A short sound is not padded to the event's maximum duration.
    recorded(clip([0, 0, 0.1, 0.2, 0, 0]), quiet, 1, 'step').play(into)
    assertEquals(starts[1], [ctx.currentTime, 0.002, 0.002])
  } finally {
    if (original) {
      Object.defineProperty(globalThis, 'AudioBufferSourceNode', original)
    } else Reflect.deleteProperty(globalThis, 'AudioBufferSourceNode')
  }
})

test('a repeated one-shot steals its source voice while other actions and sources continue', () => {
  let a = audio(), b = audio(), stops = 0
  let voice: Voice = {
    ...quiet,
    play: () => () => {
      stops++
    },
  }
  let first = oneShots(a.into), other = oneShots(b.into)
  first.play(voice, 'step')
  first.play(voice, 'cry')
  other.play(voice, 'step')
  first.play(voice, 'step')
  assertEquals(a.gates.map((gate) => gate.connected), [false, true, true])
  assertEquals(b.gates.map((gate) => gate.connected), [true])
  assertEquals(stops, 1)
  a.ctx.currentTime += 1
  first.prune()
  assertEquals(a.gates.map((gate) => gate.connected), [false, false, false])
  assertEquals(stops, 3)
})

test('an entirely silent generated clip uses its procedural voice', () => {
  let played = 0
  let fallback = {
    ...quiet,
    play: () => {
      played++
    },
  }
  recorded(clip([0, 0, 0]), fallback, 1, 'step').play(audio().into)
  assertEquals(played, 1)
})
