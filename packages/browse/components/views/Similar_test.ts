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

type Call = {
  url: string
  signal: AbortSignal | null | undefined
  resolve: (value: Response) => void
  reject: (error: Error) => void
}

// The entities Similar reads, cached once: a fresh cache costs its first read
// more than the renders a case checks. `b` has only a body; `blank` has no
// text at all.
cache.value = {
  a: { entity: { eid: 'a', num: 1 }, doc: { eid: 'a', title: 'first' } },
  b: {
    entity: { eid: 'b', num: 2 },
    doc: { eid: 'b', title: '', body: 'body' },
  },
  blank: {
    entity: { eid: 'blank', num: 3 },
    doc: { eid: 'blank', title: ' ', body: '' },
  },
  hit: {
    entity: { eid: 'hit', num: 4 },
    doc: { eid: 'hit', title: 'neighbor' },
  },
}

// Similar shown for `eid`, each request it makes held as a call. It asks as
// it renders, so the page's fetch and host are lent to it only then.
let fixture = (eid: string) => {
  let calls: Call[] = []
  let draw = (paint: () => void) => {
    let { host } = config, fetcher = globalThis.fetch
    config.host = 'test'
    globalThis.fetch = (url, init) =>
      new Promise((resolve, reject) => {
        calls.push({ url: String(url), signal: init?.signal, resolve, reject })
      })
    try {
      act(paint)
    } finally {
      config.host = host
      globalThis.fetch = fetcher
    }
  }
  let mounted!: ReturnType<typeof mount>
  draw(() => {
    mounted = mount(h(Similar, { e: ent(eid) }))
  })
  let freed = false
  return {
    calls,
    root: mounted.root,
    show: (eid: string) =>
      draw(() =>
        render(h(Ux, { host: ux }, h(Similar, { e: ent(eid) })), mounted.root)
      ),
    free: () => {
      if (freed) return
      freed = true
      act(() => mounted.free())
    },
  }
}

// One way a request ends, and the renders it leads to.
let settle = (end: () => void) =>
  act(async () => {
    end()
    for (let i = 0; i < 4; i++) await Promise.resolve()
  })

let answer = (score: number) => {
  let response = new Response()
  response.json = () =>
    Promise.resolve([
      { entity: { eid: 'hit' }, rank: { score } },
    ])
  return response
}

// A test of Similar shown for `eid`, freed after.
let similar = (
  check: (f: ReturnType<typeof fixture>) => Promise<void> | void,
  eid = 'a',
) =>
async () => {
  let f = fixture(eid)
  try {
    await check(f)
  } finally {
    f.free()
  }
}

test(
  'Similar asks for the shown entity’s neighbours and aborts the request it replaces',
  similar((f) => {
    assert(f.calls[0].signal instanceof AbortSignal)
    assertEquals(f.calls[0].signal.aborted, false)
    // `b` has no title; its body is the text it asks near.
    f.show('b')
    assertEquals(f.calls[0].signal.aborted, true)
    assertEquals(f.calls[1].signal?.aborted, false)
    assertEquals(
      new URL(f.calls[1].url, 'http://test').searchParams.get('q'),
      '.near=b&.order=similar&.limit=5',
    )
  }),
)

test(
  'Similar shows an answer and ignores the late answer of a request it replaced',
  similar(async (f) => {
    f.show('b')
    await settle(() => f.calls[1].resolve(answer(0.99)))
    assert(f.root.textContent?.includes('0.99'), f.root.innerHTML)
    await settle(() => f.calls[0].resolve(answer(0.88)))
    assert(f.root.textContent?.includes('0.99'), f.root.innerHTML)
    assert(!f.root.textContent?.includes('0.88'))
  }),
)

test(
  'Similar aborts its request when unmounted and ignores its late answer',
  similar(async (f) => {
    f.free()
    assertEquals(f.calls[0].signal?.aborted, true)
    await settle(() => f.calls[0].resolve(answer(0.97)))
    assertEquals(f.root.textContent, '')
  }),
)

test(
  'Similar clears its neighbours when a request fails',
  similar(async (f) => {
    await settle(() => f.calls[0].resolve(answer(0.99)))
    assert(f.root.textContent?.includes('0.99'), f.root.innerHTML)
    f.show('b')
    await settle(() => f.calls[1].reject(new Error('network failure')))
    assertEquals(f.root.textContent, '')
  }),
)

test(
  'Similar asks nothing for blank text or a missing entity',
  similar((f) => {
    assertEquals([f.calls.length, f.root.textContent], [0, ''])
    f.show('missing')
    assertEquals([f.calls.length, f.root.textContent], [0, ''])
  }, 'blank'),
)
