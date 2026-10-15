import { equal, test } from '@yaks/testing'
import { sources } from './sound.ts'
import type { Ear } from './ears.ts'

// A small audio-graph double keeps this about source lifetime and motion rather
// than about the browser's codec, HRTF or device.
test('following sound sources move, release when absent and keep channels separate', () => {
  let previous = Object.getOwnPropertyDescriptor(globalThis, 'PannerNode')
  let gains = Object.getOwnPropertyDescriptor(globalThis, 'GainNode')
  let nodes: Pan[] = []
  class Node {
    disconnected = false
    gain = { value: 1 }
    constructor(public context: AudioContext) {}
    connect(node: AudioNode) {
      return node
    }
    disconnect() {
      this.disconnected = true
    }
  }
  class Pan extends Node {
    positionX = { value: 0 }
    positionY = { value: 0 }
    positionZ = { value: 0 }
    constructor(ctx: AudioContext) {
      super(ctx)
      nodes.push(this)
    }
  }
  Object.defineProperty(globalThis, 'PannerNode', {
    configurable: true,
    value: Pan,
  })
  Object.defineProperty(globalThis, 'GainNode', {
    configurable: true,
    value: Node,
  })
  try {
    let time = 0
    let ctx = {
      get currentTime() {
        return time
      },
      listener: { setPosition() {}, setOrientation() {} },
    } as unknown as AudioContext
    let out = new Node(ctx) as unknown as AudioNode
    let bank = sources<'fx' | 'speech'>(ctx, { fx: out, speech: out }, 'fx')
    let ear: Ear = { at: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] }
    bank.listen(ear, new Map([['moving', [1, 2, 3]]]))
    let ended = 0
    let sound = () => () => {
      ended++
    }
    let stop = bank.keep('moving', sound)
    bank.keep('moving', sound, undefined, 'speech')
    equal(bank.playing('moving'), true)
    equal(nodes.map((p) => p.positionX.value), [1, 1])
    bank.listen(ear, new Map([['moving', [4, 5, 6]]]))
    equal(nodes.map((p) => p.positionZ.value), [6, 6])
    stop()
    stop()
    equal(ended, 1)
    equal(bank.playing('moving'), false)
    equal(bank.playing('moving', 'speech'), true)
    bank.listen(ear, new Map())
    equal(ended, 2)
    time = 2
    bank.listen(ear, new Map())
    equal(nodes.map((p) => p.disconnected), [true, true])
  } finally {
    for (
      let [key, descriptor] of [['PannerNode', previous], [
        'GainNode',
        gains,
      ]] as const
    ) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
