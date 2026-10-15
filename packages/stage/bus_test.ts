import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { bus } from './bus.ts'

test('volume controls stay between silence and full level', () => {
  let level = bus(0.6)
  assertEquals(level.level, 0.6)
  level.set(2)
  assertEquals(level.level, 1)
  level.set(-1)
  assertEquals(level.level, 0)
  level.set(NaN)
  assertEquals(level.level, 0.6)
})

test('slider loudness reaches playing sounds, silence, and a new context', () => {
  let was = Object.getOwnPropertyDescriptor(globalThis, 'GainNode')
  let connected: unknown[] = []
  class Gain {
    gain: {
      value: number
      cancelScheduledValues: (at: number) => void
      setValueAtTime: (value: number, at: number) => void
      linearRampToValueAtTime: (value: number, at: number) => void
    }
    constructor(public context: AudioContext, options: { gain: number }) {
      this.gain = {
        value: options.gain,
        cancelScheduledValues: () => {},
        setValueAtTime: (value) => this.gain.value = value,
        linearRampToValueAtTime: (value) => this.gain.value = value,
      }
    }
    connect(out: AudioNode) {
      connected.push(out)
    }
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'GainNode', {
    configurable: true,
    value: Gain,
  })
  try {
    let ctx = { currentTime: 1 } as AudioContext
    let out = {} as AudioNode
    let channel = bus(1, { boost: 2 })
    let node = channel.into(ctx, out)
    let full = node.gain.value
    assertEquals(full, 2)
    for (let level of [0.75, 0.5, 0.25, 0.1]) {
      channel.set(level)
      // Each halving should sound markedly quieter, long before 10%.
      assert(node.gain.value > 0 && node.gain.value < full * level ** 2)
      assertEquals(channel.into(ctx, out), node)
    }
    channel.set(0)
    assertEquals(node.gain.value, 0)
    channel.set(0.5)
    let resumed = channel.into({ currentTime: 0 } as AudioContext, out)
    assertEquals(resumed.gain.value, node.gain.value)
    assertEquals(channel.level, 0.5)
    assertEquals(connected, [out, out])
  } finally {
    if (was) Object.defineProperty(globalThis, 'GainNode', was)
    else Reflect.deleteProperty(globalThis, 'GainNode')
  }
})

test('a volume setting is supplied and saved by its caller', () => {
  let saved: number[] = []
  let music = bus(0.35, { save: (level) => saved.push(level) })
  assertEquals(music.level, 0.35)
  music.set(0.8)
  assertEquals(saved, [0.8])
})
