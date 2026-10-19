// Similar owns each HTTP request only until its effect is replaced or removed.
import '../../testing.ts'
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { Ux } from '@yaks/ux'
import { cache, config, ent } from '../../live.ts'
import { mount } from '../mount.ts'
import { ux } from '../registry.ts'
import '../Entity.tsx'
import { Similar } from './Show.tsx'

let fixture = () => {
  let host = config.host
  config.host = 'test'
  let fetcher = globalThis.fetch
  let calls: {
    url: string
    signal: AbortSignal | null | undefined
    resolve: (value: Response) => void
    reject: (error: Error) => void
  }[] = []
  globalThis.fetch = (url, init) =>
    new Promise((resolve, reject) => {
      calls.push({ url: String(url), signal: init?.signal, resolve, reject })
    })
  cache.value = {
    a: { entity: { eid: 'a', num: 1 }, doc: { eid: 'a', title: 'first' } },
    b: {
      entity: { eid: 'b', num: 2 },
      doc: { eid: 'b', title: '', body: 'body' },
    },
    hit: {
      entity: { eid: 'hit', num: 3 },
      doc: { eid: 'hit', title: 'neighbor' },
    },
  }
  let freed = false
  let mounted: ReturnType<typeof mount>
  act(() => {
    mounted = mount(h(Similar, { e: ent('a') }))
  })
  return {
    calls,
    get root() {
      return mounted.root
    },
    show: (eid: string) =>
      act(() =>
        render(
          h(Ux, { host: ux }, h(Similar, { e: ent(eid) })),
          mounted.root,
        )
      ),
    free: () => {
      if (freed) return
      freed = true
      act(() => mounted.free())
    },
    restore: () => {
      config.host = host
      globalThis.fetch = fetcher
      cache.value = {}
    },
  }
}
let answer = (score: number) => {
  let response = new Response()
  response.json = () =>
    Promise.resolve([
      { entity: { eid: 'hit' }, rank: { score } },
    ])
  return response
}

test('Similar aborts replaced and unmounted requests and ignores late answers', async () => {
  let f = fixture()
  try {
    assert(f.calls[0].signal instanceof AbortSignal)
    assertEquals(f.calls[0].signal.aborted, false)
    f.show('b')
    assertEquals(f.calls[0].signal.aborted, true)
    assertEquals(f.calls[1].signal?.aborted, false)
    assertEquals(
      new URL(f.calls[1].url, 'http://test').searchParams.get('q'),
      '.near=b&.order=similar&.limit=5',
    )
    await act(async () => {
      f.calls[1].resolve(answer(0.99))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert(f.root.textContent?.includes('0.99'), f.root.innerHTML)
    await act(async () => {
      f.calls[0].resolve(answer(0.88))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert(f.root.textContent?.includes('0.99'), f.root.innerHTML)
    assert(!f.root.textContent?.includes('0.88'))
    f.show('a')
    f.free()
    assertEquals(f.calls[2].signal?.aborted, true)
    await act(async () => {
      f.calls[2].resolve(answer(0.97))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    assertEquals(f.root.textContent, '')
  } finally {
    f.free()
    f.restore()
  }
})

test('Similar retains body fallback, blank handling and failed-request clearing', async () => {
  let f = fixture()
  try {
    await act(async () => {
      f.calls[0].resolve(answer(0.99))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert(f.root.textContent?.includes('0.99'), f.root.innerHTML)
    f.show('b')
    assertEquals(f.calls.length, 2)
    await act(async () => {
      f.calls[1].reject(new Error('network failure'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    assertEquals(f.root.textContent, '')
    cache.value = {
      ...cache.value,
      b: {
        entity: { eid: 'b', num: 2 },
        doc: { eid: 'b', title: ' ', body: '' },
      },
    }
    f.show('b')
    assertEquals(f.calls.length, 2)
    assertEquals(f.root.textContent, '')
    f.show('missing')
    assertEquals(f.calls.length, 2)
  } finally {
    f.free()
    f.restore()
  }
})
