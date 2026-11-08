// The library tools (library-tools.ts) as an agent building a Document Q&A
// app calls them: a PDF and a web page added by address become extracted,
// searched documents that keep where they came from, what a site forbids is
// skipped and said, a file attached in chat and bytes sent along are added
// too, a document is read and removed, and someone below the app's upload
// floor is refused.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import './binding-probe.ts'
import { embeds } from './model-probe.ts'
import { connector, fresh, meta, seed, signIn } from './probe.ts'
import { sha256 } from './versions.ts'
import type { Env } from './env.ts'
import { libraryTools } from './library-tools.ts'

let SITE = 'https://library.test'
let ROBOTS = 'User-agent: *\nDisallow: /private\n'
let HTML = `<!doctype html><html><head><title>Shorter Catechism, Q1</title>
<script>track()</script></head><body><nav>Subscribe</nav>
<article><p>Man's chief end is to glorify God.</p></article>
<footer>Copyright</footer></body></html>`
let PDF = '%PDF-1.4 the confession'

// The site the tools read, and nothing else of the network.
let site = (req: Request) => {
  let path = new URL(req.url).pathname
  let send = (body: string, type: string, headers = {}) =>
    new Response(body, { headers: { 'content-type': type, ...headers } })
  return path == '/robots.txt'
    ? send(ROBOTS, 'text/plain')
    : path == '/confession.pdf'
    ? send(PDF, 'application/pdf')
    : path == '/q1'
    ? send(HTML, 'text/html; charset=utf-8')
    : path == '/kept'
    ? send(HTML, 'text/html', { 'x-robots-tag': 'noarchive' })
    : path.startsWith('/private')
    ? send('never read', 'text/html')
    : new Response('no robots', { status: 403 })
}

let fetched: string[] = []
let AI = embeds({
  gateway: () => ({ getUrl: () => Promise.resolve('') }),
  toMarkdown: async ({ blob }: { blob: Blob }) => ({
    format: 'markdown',
    data: (await blob.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      .trim(),
  }),
} as never) as unknown as Env['AI']
// The PDF parser: one page of text.
let RASTER = {
  fetch: (req: Request) =>
    Promise.resolve(Response.json(
      new URL(req.url).searchParams.has('page')
        ? { pages: 1, text: 'We believe in one God, the confession says.' }
        : { pages: 1 },
    )),
}

type Doc = {
  eid: string
  name: string
  source?: string
  state: string
  pages?: number
}

test('the library tools add, list, read and remove an app’s documents', async () => {
  let env: Env | undefined
  let k = await fresh({ AI, RASTER } as never, (e) => void (env = e))
  let real = globalThis.fetch
  globalThis.fetch = (input, init) => {
    let req = new Request(input, init)
    if (new URL(req.url).origin != SITE) return real(input, init)
    fetched.push(new URL(req.url).pathname)
    return Promise.resolve(site(req))
  }
  try {
    let who = await seed(k, [{ slug: 'church', apps: [] }])
    let agent = connector(k, who.cookie)
    let at = { space: 'church', app: 'library' }
    await agent.tool('app_new', {
      ...at,
      slug: 'library',
      title: 'Catechism',
      access: 'open',
    })
    await agent.tool('app_files', {
      ...at,
      path: 'vocab.json',
      content: '{ "blob": { "floor": "editor" } }',
    })
    await agent.tool('app_deploy', at)

    let { value } = await agent.answer('library_add', {
      ...at,
      documents: [
        { url: SITE + '/confession.pdf' },
        { url: SITE + '/q1' },
        { url: SITE + '/private/notes' },
        { url: SITE + '/kept' },
        { url: SITE + '/refuses' },
      ],
    }) as { value: Record<string, { from: string; reason: string }[]> }
    assertEquals(value.added.map((a) => a.from), [
      SITE + '/confession.pdf',
      SITE + '/q1',
    ])
    let why = Object.fromEntries(value.skipped.map((s) => [s.from, s.reason]))
    assertStringIncludes(why[SITE + '/private/notes'], 'robots.txt')
    assertStringIncludes(why[SITE + '/kept'], 'noarchive')
    assertStringIncludes(why[SITE + '/refuses'], '403')
    assert(!fetched.includes('/private/notes'), 'a forbidden page was fetched')

    // A file the person attached in chat, and bytes sent along.
    let held = new TextEncoder().encode('The Lord is my shepherd.')
    let sha = await sha256(held)
    let space = await k.dir.space('church')
    await env!.BLOBS.put(`${space!.store}/.operator/${sha}`, held)
    await agent.answer('library_add', {
      ...at,
      documents: [
        { attachment: sha, name: 'Psalm 23.txt' },
        { base64: btoa('Blessed are the meek.'), name: 'Beatitudes.md' },
      ],
    })
    await k.settled()

    let list = async () =>
      ((await agent.answer('library_list', at)).value as { documents: Doc[] })
        .documents
    let docs = new Map((await list()).map((d) => [d.name, d]))
    assertEquals([...docs.keys()].sort(), [
      'Beatitudes.md',
      'Psalm 23.txt',
      'Shorter Catechism, Q1',
      'confession.pdf',
    ])
    for (let d of docs.values()) assertEquals(d.state, 'searchable', d.name)
    assertEquals(docs.get('confession.pdf')!.source, SITE + '/confession.pdf')
    assertEquals(docs.get('Shorter Catechism, Q1')!.source, SITE + '/q1')

    // Searched as a page's search reads it; the article without its menus.
    let sources: (string | undefined)[] = []
    let last = ''
    let found = async (words: string) => {
      let r = await k.at('church.yaks.app', '/library/api/documents/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ words }),
      })
      let hits = await r.json() as {
        document: { eid: string; source?: string }
      }[]
      last = JSON.stringify(hits).slice(0, 3000)
      sources.push(...hits.map((h) => h.document.source))
      return hits.map((h) => h.document.eid)
    }
    assertEquals(await found('chief'), [
      docs.get('Shorter Catechism, Q1')!.eid,
    ], last)
    assertEquals(
      await found('believe'),
      [docs.get('confession.pdf')!.eid],
      last,
    )
    assertEquals(await found('shepherd'), [docs.get('Psalm 23.txt')!.eid])
    assertEquals(sources, [SITE + '/q1', SITE + '/confession.pdf', undefined])

    let read = await agent.tool('library_read', {
      ...at,
      document: docs.get('Shorter Catechism, Q1')!.eid,
    })
    assertStringIncludes(read, 'chief end')
    for (let gone of ['Subscribe', 'track()', 'Copyright']) {
      assert(!read.includes(gone), `${gone} was kept`)
    }

    // A viewer is below the editor floor, and nothing of theirs is kept.
    let viewer = await signIn(k)
    await meta(k).apply([{
      entity: { eid: crypto.randomUUID() },
      member: { space: space!.eid, person: viewer.person, role: 'viewer' },
    }])
    let refused = await connector(k, viewer.cookie).call('tools/call', {
      name: 'library_add',
      arguments: { ...at, documents: [{ url: SITE + '/q1' }] },
    })
    assert(refused.isError)
    assertStringIncludes(refused.content[0].text, 'editor is the least')

    // Replaced, then removed with its text.
    let pdf = docs.get('confession.pdf')!.eid
    await agent.answer('library_add', {
      ...at,
      documents: [{
        base64: btoa('A newer confession.'),
        name: 'Confession.txt',
        replaces: pdf,
      }],
    })
    await agent.answer('library_remove', {
      ...at,
      documents: [docs.get('Beatitudes.md')!.eid],
    })
    await k.settled()
    assertEquals((await list()).map((d) => d.name).sort(), [
      'Confession.txt',
      'Psalm 23.txt',
      'Shorter Catechism, Q1',
    ])
    assertEquals(await found('believe'), [])
    assertEquals(await found('meek'), [])
  } finally {
    globalThis.fetch = real
    await k.stop()
  }
})

let widePage = 'Start of document. ' + 'page text '.repeat(6_100) +
  'Final words.'
let wideLibrary = await (async () => {
  let env: Env | undefined
  let k = await fresh({ AI } as never, (e) => void (env = e))
  let who = await seed(k, [{ slug: 'wide', apps: [] }])
  let agent = connector(k, who.cookie)
  let at = { space: 'wide', app: 'library' }
  await agent.tool('app_new', { ...at, slug: 'library', title: 'Library' })
  await agent.tool('app_deploy', at)
  let added = await agent.answer('library_add', {
    ...at,
    documents: [{ base64: btoa(widePage), name: 'Wide page.txt' }],
  })
  await k.settled()
  return {
    k,
    ctx: { env: env!, dir: k.dir, person: who.person },
    args: { ...at, document: (added.value!.added as { eid: string }[])[0].eid },
  }
})()

test('library_read preserves a page larger than its page selection budget', async () => {
  try {
    let read = await libraryTools.find((t) => t.name == 'library_read')!.run(
      wideLibrary.ctx,
      wideLibrary.args,
    )
    assertEquals(read.text, '## Document\n\n' + widePage)
    assertEquals(read.value?.to, 1)
    assertEquals(read.value?.next, undefined)
  } finally {
    await wideLibrary.k.stop()
  }
})
