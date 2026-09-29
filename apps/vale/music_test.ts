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
