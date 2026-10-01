// A region owns one song source at a time, including while the hero reverses
// course across a border.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { heard, music } from './music.ts'
import { TRACKS } from './music_tracks.ts'
import { seedThemes } from './themes_fixture.ts'

test('a border holds the playing region until its neighbor leads', () => {
  let edge = { a: 'birchmere', b: 'mossvale', t: 0.55 }
  assertEquals(heard(edge, 'mossvale'), 'mossvale')
  assertEquals(heard(edge, 'birchmere'), 'birchmere')
  assertEquals(heard({ ...edge, t: 0.8 }, 'mossvale'), 'birchmere')
})

test('region music finishes one source before starting another', async () => {
  using time = new FakeTime()
  seedThemes()
  let doc = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let sourceWas = Object.getOwnPropertyDescriptor(
    globalThis,
    'AudioBufferSourceNode',
  )
  let fetchWas = globalThis.fetch
  let sources: Source[] = []
  let held = Promise.withResolvers<Response>()
  let hold: string | null = null
  let playing = () => sources.filter((source) => source.playing).length
  class Source {
    onended: (() => void) | null = null
    playing = false
    stopped = false
    constructor(_ctx: AudioContext, _options: { buffer: AudioBuffer }) {
      sources.push(this)
    }
    connect(_gain: GainNode) {}
    disconnect() {}
    start() {
      assertEquals(playing(), 0)
      this.playing = true
    }
    stop() {
      this.playing = false
      this.stopped = true
      this.onended?.()
    }
  }
  let param = () => ({
    value: 0,
    cancelScheduledValues(_at: number) {},
    setValueAtTime(value: number, _at: number) {
      this.value = value
    },
    linearRampToValueAtTime(value: number, _at: number) {
      this.value = value
    },
  })
  let ctx = {
    currentTime: 0,
    createGain: () => ({ gain: param(), connect() {}, disconnect() {} }),
    decodeAudioData: (_bytes: ArrayBuffer) => Promise.resolve({}),
  } as unknown as AudioContext
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { baseURI: 'https://yourname.yaks.app/vale/' },
  })
  Object.defineProperty(globalThis, 'AudioBufferSourceNode', {
    configurable: true,
    value: Source,
  })
  globalThis.fetch = (url) =>
    hold && String(url).includes(hold)
      ? held.promise
      : Promise.resolve(new Response(new Uint8Array([1])))
  let mossvale: [number, number, number] = [128, 0, 128]
  let birchmere: [number, number, number] = [-128, 0, 128]
  try {
    music.at(mossvale)
    music.start(ctx, {} as AudioNode)
    await time.tickAsync(0)
    assertEquals(playing(), 1)

    music.at(birchmere)
    await time.tickAsync(300)
    assertEquals(playing(), 1)
    assertEquals(sources.length, 1)
    music.at(mossvale)
    await time.tickAsync(1000)
    assertEquals(playing(), 1)
    assertEquals(sources.length, 1)
    assertEquals(sources[0].stopped, false)

    music.at(birchmere)
    await time.tickAsync(699)
    assertEquals(sources.length, 1)
    await time.tickAsync(1)
    await time.tickAsync(0)
    assertEquals(sources[0].stopped, true)
    assertEquals(playing(), 1)
    assertEquals(sources.length, 2)

    music.at(mossvale)
    await time.tickAsync(300)
    music.at(birchmere)
    await time.tickAsync(1000)
    assertEquals(playing(), 1)
    assertEquals(sources.length, 2)
    assertEquals(sources[1].stopped, false)

    hold = TRACKS.mossvale[0]
    music.at(mossvale)
    await time.tickAsync(700)
    await time.tickAsync(0)
    assertEquals(playing(), 0)
    music.at(birchmere)
    await time.tickAsync(0)
    assertEquals(playing(), 1)
    held.resolve(new Response(new Uint8Array([1])))
    await time.tickAsync(0)
    assertEquals(playing(), 1)
    assertEquals(sources.length, 3)
  } finally {
    held.resolve(new Response(new Uint8Array([1])))
    globalThis.fetch = fetchWas
    if (doc) Object.defineProperty(globalThis, 'document', doc)
    else Reflect.deleteProperty(globalThis, 'document')
    if (sourceWas) {
      Object.defineProperty(globalThis, 'AudioBufferSourceNode', sourceWas)
    } else Reflect.deleteProperty(globalThis, 'AudioBufferSourceNode')
  }
})

test('unavailable songs are skipped and reported once for the page', async () => {
  using time = new FakeTime()
  seedThemes()
  // A fresh page owns its own music singleton and unavailable-song set.
  let { music } = await import('./music.ts?unavailable')
  let doc = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let sourceWas = Object.getOwnPropertyDescriptor(
    globalThis,
    'AudioBufferSourceNode',
  )
  let report = Object.getOwnPropertyDescriptor(globalThis, 'reportError')
  let fetchWas = globalThis.fetch
  let requests: string[] = [], failures: unknown[] = [], sources: Source[] = []
  class Source {
    onended: (() => void) | null = null
    constructor() {
      sources.push(this)
    }
    connect() {}
    disconnect() {}
    start() {}
    stop() {
      this.onended?.()
    }
  }
  let ctx = {
    currentTime: 0,
    createGain: () => ({
      gain: {
        value: 0,
        cancelScheduledValues() {},
        setValueAtTime() {},
        linearRampToValueAtTime() {},
      },
      connect() {},
      disconnect() {},
    }),
    decodeAudioData: (bytes: ArrayBuffer) =>
      new Uint8Array(bytes)[0] == 0
        ? Promise.reject(new Error('invalid song'))
        : Promise.resolve({}),
  } as unknown as AudioContext
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { baseURI: 'https://yourname.yaks.app/vale/' },
  })
  Object.defineProperty(globalThis, 'AudioBufferSourceNode', {
    configurable: true,
    value: Source,
  })
  Object.defineProperty(globalThis, 'reportError', {
    configurable: true,
    value: (error: unknown) => failures.push(error),
  })
  globalThis.fetch = (url) => {
    let sha = String(url).split('/').at(-1)!
    requests.push(sha)
    return Promise.resolve(
      sha == TRACKS.mossvale[1]
        ? new Response(new Uint8Array([1]))
        : sha == TRACKS.birchmere[0]
        ? new Response(new Uint8Array([0]))
        : new Response('', { status: 404 }),
    )
  }
  let mossvale: [number, number, number] = [128, 0, 128]
  let birchmere: [number, number, number] = [-128, 0, 128]
  try {
    music.at(mossvale)
    music.start(ctx, {} as AudioNode)
    await time.tickAsync(0)
    assertEquals(requests, TRACKS.mossvale)
    assertEquals(failures.length, 1)
    assertEquals(sources.length, 1)

    sources[0].stop()
    await time.tickAsync(8000)
    await time.tickAsync(0)
    assertEquals(requests, [...TRACKS.mossvale, TRACKS.mossvale[1]])
    assertEquals(failures.length, 1)
    assertEquals(sources.length, 2)

    music.at(birchmere)
    await time.tickAsync(700)
    await time.tickAsync(0)
    let tried = [...TRACKS.mossvale, TRACKS.mossvale[1], ...TRACKS.birchmere]
    assertEquals(requests, tried)
    assertEquals(failures.length, 3)
    assertEquals(sources.length, 2)
    await time.tickAsync(60000)
    music.at(birchmere)
    assertEquals(requests, tried)
    assertEquals(failures.length, 3)

    music.at(mossvale)
    await time.tickAsync(0)
    assertEquals(sources.length, 3)
    music.at(birchmere)
    await time.tickAsync(60700)
    assertEquals(requests, [...tried, TRACKS.mossvale[1]])
    assertEquals(failures.length, 3)
    assertEquals(sources.length, 3)
  } finally {
    globalThis.fetch = fetchWas
    if (doc) Object.defineProperty(globalThis, 'document', doc)
    else Reflect.deleteProperty(globalThis, 'document')
    if (sourceWas) {
      Object.defineProperty(globalThis, 'AudioBufferSourceNode', sourceWas)
    } else Reflect.deleteProperty(globalThis, 'AudioBufferSourceNode')
    if (report) Object.defineProperty(globalThis, 'reportError', report)
    else Reflect.deleteProperty(globalThis, 'reportError')
  }
})
