// The package as a host composes it: the words, the canonical identity, the
// archive's door, and the capture. `compose` over the real subpaths, so what is
// checked here is the plugin a config would name.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Handler } from '@yaks/api'
import { compose, type Served } from '@yaks/cli/host'
import type { Bundle, Comp } from '@yaks/graph'
import { decode } from '@yaks/blob'
import { freezing, froze } from './freeze.ts'
import { blobsOf } from './host.ts'
import { WEB } from './comp.ts'
import { pageEid } from './url.ts'

let host = async (): Promise<Served> =>
  await compose({
    db: ':memory:',
    plugins: ['@yaks/doc', '@yaks/blob', '@yaks/page', '@yaks/api'],
    numbers: false,
  }, ['graph', 'web', 'effects'])

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let read = async (h: Served, eid: string) => (await h.graph.get([eid]))[0]

// The door this package's routes hang on: every config here names @yaks/api,
// so a host without a handler would be this file's own bug.
let door = (h: Served): Handler => {
  if (!h.handler) throw new Error('this host composed no handler')
  return h.handler
}

// A page recorded with its document, the way a host that already holds the
// bytes stores one: `froze()`, then one trusted write, since `frozen_at` and
// `bytes` are server-owned.
let kept = async (h: Served, url: string, html: string) => {
  let page = { entity: { eid: pageEid(url) } }
  let [landed] = await froze(page, html, { blobs: blobsOf(h) })
  await h.graph.apply([{ ...landed, [WEB]: { url, ...comp(landed, WEB) } }], {
    trusted: true,
  })
}

let TAB = '<title>Weather</title><p>rain</p>' +
  '<img src="https://cdn.example/x.png"><script>fetch("//elsewhere")</script>'

test('GET /page/<eid> answers the frozen document, fenced and dated', async () => {
  let h = await host()
  try {
    await kept(h, 'https://example.com/w', TAB)
    let eid = pageEid('https://example.com/w')
    let got = await door(h)(new Request(`http://h/page/${eid}`))
    assertEquals(got.status, 200)
    let html = await got.text()
    // the invariant: these bytes reach nothing
    assert(!/https?:\/\/|<script/i.test(html), html)
    assert(html.includes('rain'), html)
    assertEquals(
      got.headers.get('content-type'),
      'text/html; charset=utf-8',
    )
    assert(
      got.headers.get('content-security-policy')?.includes("script-src 'none'"),
    )
    assert(got.headers.get('memento-datetime'))
    assertEquals(
      got.headers.get('link'),
      '<https://example.com/w>; rel="original"',
    )
    // an id that never named a page is a miss, not a lookup
    assertEquals(
      (await door(h)(new Request('http://h/page/../etc'))).status,
      404,
    )
    assertEquals(
      (await door(h)(
        new Request(`http://h/page/${pageEid('https://a.com/')}`),
      ))
        .status,
      404,
    )
  } finally {
    h.close()
  }
})

test('a page witnessed by its address alone is fetched after the commit', async () => {
  let h = await host()
  try {
    let asked: string[] = []
    let blobs = blobsOf(h)
    h.fx.created(
      WEB,
      freezing({
        blobs,
        archive: (url) => {
          asked.push(url)
          return Promise.resolve(`<title>Fetched</title><a href="${url}">x</a>`)
        },
      }),
    )
    let url = 'https://example.com/later'
    await h.graph.apply([{ entity: { eid: pageEid(url) }, [WEB]: { url } }])
    assertEquals(asked, [url])
    let web = comp(await read(h, pageEid(url)), WEB)!
    assert(web.bytes, 'no bytes landed')
    // the archive named the page, since nothing else had
    assertEquals(comp(await read(h, pageEid(url)), 'doc')?.title, 'Fetched')
    // and its own link to itself was scrubbed with everything else
    assert(!decode((await blobs.get(String(web.bytes)))!).includes(url))
  } finally {
    h.close()
  }
})

test('a page that already has bytes is not fetched again', async () => {
  let h = await host()
  try {
    let asked: string[] = []
    h.fx.created(
      WEB,
      freezing({
        blobs: blobsOf(h),
        archive: (url) => {
          asked.push(url)
          return Promise.resolve('<title>no</title>')
        },
      }),
    )
    await kept(h, 'https://example.com/w', TAB)
    assertEquals(asked, [])
  } finally {
    h.close()
  }
})
