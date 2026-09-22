// The package as a host composes it: the words, the canonical identity, both
// doors, and the capture. `compose` over the real subpaths, so what is checked
// here is the plugin a config would name.

import { assert, assertEquals } from '@std/assert'
import { compose, type Served } from '@yaks/cli/host'
import type { Bundle, Comp } from '@yaks/graph'
import { detached } from '@yaks/graph'
import { decode } from '@yaks/blob'
import { freezing } from './freeze.ts'
import { blobsOf } from './host.ts'
import { WEB } from './comp.ts'
import { pageEid } from './url.ts'

let host = async (): Promise<Served> =>
  await compose({
    db: ':memory:',
    plugins: ['@yaks/doc', '@yaks/blob', '@yaks/page'],
    numbers: false,
  })

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let read = async (h: Served, eid: string) =>
  (await detached(h.storage).get([eid]))[0]

let witness = (h: Served, body: unknown) =>
  h.handler(
    new Request('http://h/page', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )

let TAB = '<title>Weather</title><p>rain</p>' +
  '<img src="https://cdn.example/x.png"><script>fetch("//elsewhere")</script>'

Deno.test('POST /page witnesses a page, bytes and all', async () => {
  let h = await host()
  try {
    let said = await witness(h, {
      url: 'HTTPS://Example.com/w/?utm_source=n#now',
      title: 'The Weather',
      html: TAB,
    })
    assertEquals(said.status, 200)
    let eid = pageEid('https://example.com/w')
    let page = await read(h, eid)
    let web = comp(page, WEB)!
    // one canonical address, and the entity its own words name
    assertEquals(web.url, 'https://example.com/w')
    assertEquals(page.entity.eid, eid)
    // the tab's title, not the archive's
    assertEquals(comp(page, 'doc')?.title, 'The Weather')
    // and the bytes, stored under their own address
    assert(/^[0-9a-f]{64}$/.test(String(web.bytes)), String(web.bytes))
    assert(!isNaN(+new Date(String(web.frozen_at))))
  } finally {
    h.close()
  }
})

Deno.test('witnessing one page twice is one entity', async () => {
  let h = await host()
  try {
    await witness(h, { url: 'https://example.com/w', title: 'One' })
    await witness(h, { url: 'https://example.com/w/?fbclid=9', title: 'Two' })
    let pages = await h.graph.read('.web')
    assertEquals(pages.length, 1)
    // the first title stands: an archive names a page only while nothing does
    assertEquals(comp(pages[0], 'doc')?.title, 'One')
  } finally {
    h.close()
  }
})

Deno.test('POST /page refuses what is not a page', async () => {
  let h = await host()
  try {
    assertEquals((await witness(h, { url: 'file:///tmp/x' })).status, 400)
    assertEquals((await witness(h, {})).status, 400)
  } finally {
    h.close()
  }
})

Deno.test('GET /page/<eid> answers the frozen document, fenced and dated', async () => {
  let h = await host()
  try {
    await witness(h, { url: 'https://example.com/w', html: TAB })
    let eid = pageEid('https://example.com/w')
    let got = await h.handler(new Request(`http://h/page/${eid}`))
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
      (await h.handler(new Request('http://h/page/../etc'))).status,
      404,
    )
    assertEquals(
      (await h.handler(
        new Request(`http://h/page/${pageEid('https://a.com/')}`),
      ))
        .status,
      404,
    )
  } finally {
    h.close()
  }
})

Deno.test('a page witnessed by its address alone is fetched after the commit', async () => {
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

Deno.test('a page that already has bytes is not fetched again', async () => {
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
    await witness(h, { url: 'https://example.com/w', html: TAB })
    assertEquals(asked, [])
  } finally {
    h.close()
  }
})
