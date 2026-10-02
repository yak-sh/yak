import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { bus } from './bus.ts'

test('sound levels resume from storage and persist independently', () => {
  let values = new Map([['mossvale.music.level', '0.35']])
  let storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
  let music = bus('music', 0.7, { storage })
  let effects = bus('effects', 1, { storage })
  let voice = bus('voice', 1, { storage })
  assertEquals([music.level, effects.level, voice.level], [0.35, 1, 1])
  effects.set(0.4)
  voice.set(0)
  music.set(0.8)
  assertEquals(bus('effects', 1, { storage }).level, 0.4)
  assertEquals(bus('voice', 1, { storage }).level, 0)
  assertEquals(bus('music', 0.7, { storage }).level, 0.8)
})

test('volume controls stay between silence and full level', () => {
  let storage = {
    getItem: () => 'invalid',
    setItem: () => {},
  }
  let level = bus('effects', 0.6, { storage })
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
    let storage = { getItem: () => null, setItem: () => {} }
    let ctx = { currentTime: 1 } as AudioContext
    let out = {} as AudioNode
    let channel = bus('voice', 1, { storage, boost: 2 })
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
