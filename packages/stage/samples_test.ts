import { equal, test } from '@yaks/testing'
import { audible, blendLoop, clips } from './samples.ts'

test('URL clips deduplicate requests, retry failures and keep contexts separate', async () => {
  let previous = globalThis.fetch
  let requests = 0, failures = 0, available = false
  let clip = {
    numberOfChannels: 1,
    length: 2,
    sampleRate: 2,
    getChannelData: () => new Float32Array([1, 1]),
  } as unknown as AudioBuffer
  let context = () =>
    ({
      decodeAudioData: () => Promise.resolve(clip),
    }) as unknown as AudioContext
  let ctx = context(), next = context()
  let decoded = clips(() => failures++)
  globalThis.fetch = () => {
    requests++
    return Promise.resolve(new Response('', { status: available ? 200 : 404 }))
  }
  try {
    equal(await decoded.load(ctx, 'https://example.test/clip'), null)
    equal(failures, 1)
    available = true
    let pending = decoded.load(ctx, 'https://example.test/clip')
    equal(decoded.load(ctx, 'https://example.test/clip'), pending)
    equal(await pending, clip)
    equal(await decoded.load(ctx, 'https://example.test/clip'), clip)
    equal(decoded.loaded(next, 'https://example.test/clip'), undefined)
    equal(requests, 2)
  } finally {
    globalThis.fetch = previous
  }
})

test('loop overlap joins the recorded end to its attack', () => {
  equal(
    [...blendLoop(new Float32Array([1, 2, 3, 4, 5, 6]), 2)],
    [11 / 3, 10 / 3, 3, 4].map(Math.fround),
  )
})

test('audible bounds trim codec silence, while silence has no duration', () => {
  let clip = (data: number[]) =>
    ({
      numberOfChannels: 1,
      length: data.length,
      sampleRate: 10,
      getChannelData: () => new Float32Array(data),
    }) as unknown as AudioBuffer
  equal(audible(clip([0, 0, 1, 0.5, 0])), { offset: 0.2, dur: 0.2 })
  equal(audible(clip([0, 0])), { offset: 0, dur: 0 })
})
