// Document Q&A as its guide page writes it (public/docs/library.md): the
// page's own manifest and worker, lifted out of it and deployed to an open
// app. An editor keeps a web article through the worker, its HTML is
// extracted like a Word file's, a visitor's question is answered citing it
// with its original address, and a visitor's upload is refused.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import * as io from '@yaks/file/io'
import './binding-probe.ts'
import { ANSWER } from './documents.ts'
import { embeds } from './model-probe.ts'
import { client, connector, seed } from './probe.ts'
import { appDoc } from './vocab.ts'
import { serverSource, workerKernel } from './worker-probe.ts'
import type { Env } from './env.ts'

// The page's indented code blocks, whole, blank lines inside them kept.
let blocks = (slug: string) => {
  let out: string[] = [], block: string[] = []
  let text = io.readTextFileSync(
    new URL(`./public/docs/${slug}.md`, import.meta.url),
  )
  for (let line of text.split('\n')) {
    if (line.startsWith('    ')) block.push(line.slice(4))
    else if (line.trim() == '') block.length && block.push('')
    else {
      if (block.length) out.push(block.join('\n').trimEnd())
      block = []
    }
  }
  return out
}
let page = blocks('library')
let manifest = page.find((b) => b.startsWith('{ "models"'))!
let worker = page.find((b) => b.includes('export default'))!

let ARTICLE = 'https://articles.test/chief-end'
let HTML = `<!doctype html><html><head><title>Shorter Catechism, Q1</title>
<script>track()</script></head><body>
<nav>Subscribe to our newsletter</nav>
<article><h1>Question 1</h1>
<p>Man's chief end is to glorify God, and to enjoy him for ever.</p></article>
<footer>Copyright</footer></body></html>`

// The site the worker reads, and nothing else of the network.
let site = (req: Request) =>
  req.url == ARTICLE
    ? new Response(HTML, { headers: { 'content-type': 'text/html' } })
    : new Response('gone', { status: 404 })

let converted: string[] = []
let AI = embeds({
  gateway: () => ({ getUrl: () => Promise.resolve('') }),
  // Workers AI's conversion, as markdown of the page's text.
  toMarkdown: async ({ blob }: { name: string; blob: Blob }) => {
    let html = await blob.text()
    converted.push(blob.type + ' ' + html)
    return {
      format: 'markdown',
      data: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    }
  },
  // The answer cites the source that holds the chief end.
  run: (model: string, input: unknown) => {
    let said = (input as { messages?: { content: unknown }[] }).messages
    let asked = model == ANSWER && typeof said?.[1]?.content == 'string'
      ? JSON.parse(said[1].content).sources as {
        source: number
        text: string
      }[]
      : null
    let hit = asked?.find((s) => s.text.includes('chief end'))
    return Promise.resolve({
      response: hit
        ? JSON.stringify({ answer: 'To glorify God.', citations: [hit.source] })
        : '',
      tool_calls: [],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    })
  },
}) as unknown as Env['AI']

test('a library app keeps a web article and answers a visitor citing it', async () => {
  let dir = io.makeTempDirSync({ prefix: 'yak-library-' })
  io.writeTextFileSync(`${dir}/worker.js`, worker)
  let real = globalThis.fetch
  globalThis.fetch = (input, init) => {
    let req = new Request(input, init)
    return new URL(req.url).host == 'articles.test'
      ? Promise.resolve(site(req))
      : real(input, init)
  }
  let k = await workerKernel(new URL(`file://${dir}/worker.js`), { AI })
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
      files: [{ path: 'vocab.json', content: manifest }, serverSource],
    })
    await agent.tool('app_deploy', at)
    let host = 'church.yaks.app'
    let post = (path: string, body: unknown, headers = {}) =>
      k.at(host, '/library/' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })

    let kept = await post('article', { url: ARTICLE }, { cookie: who.cookie })
    let article = await kept.json()
    assertEquals(kept.status, 200, JSON.stringify(article))
    assertEquals(article.title, 'Shorter Catechism, Q1')
    await k.settled()

    // The page as the article alone reached the conversion, as a web page.
    assertEquals(converted.length, 1)
    assert(converted[0].startsWith('text/html'), converted[0])
    assertStringIncludes(converted[0], 'chief end')
    for (let gone of ['newsletter', 'track()', 'Copyright']) {
      assert(!converted[0].includes(gone), `${gone} was kept`)
    }
    let editor = client(k, host, 'library', who.cookie)
    let [shelf] = await editor.get('.attachment&?document_text') as {
      entity: { eid: string }
      attachment: { source?: string }
      document_text?: { pages: number }
    }[]
    assertEquals(shelf.entity.eid, article.eid)
    assertEquals(shelf.attachment.source, ARTICLE)
    assertEquals(shelf.document_text?.pages, 1)

    // A stranger asks, and the answer cites the article by its title.
    let visitor = { 'cf-connecting-ip': '198.18.7.7' }
    let asked = await post('api/documents/ask', {
      words: 'What is the chief end of man?',
      scope: '.document_page',
    }, visitor)
    let answer = await asked.json()
    assertEquals(asked.status, 200, JSON.stringify(answer))
    assertEquals(answer.answer, 'To glorify God.')
    assertEquals(answer.citations.length, 1)
    let [cited] = answer.citations
    assertEquals(cited.document.eid, article.eid)
    assertEquals(cited.document.name, 'Shorter Catechism, Q1')
    assertEquals(cited.location, 'Document')
    // And links to its original address.
    assertEquals(cited.document.source, ARTICLE)

    // A visitor uploads nothing, through the blob door or the worker.
    let upload = await k.at(host, '/library/api/blob', {
      method: 'POST',
      headers: { ...visitor, 'content-type': 'text/html', 'x-yak-name': 'x' },
      body: '<p>a visitor’s page</p>',
    })
    let refusal = await upload.json()
    assertEquals(upload.status, 403, JSON.stringify(refusal))
    assertStringIncludes(refusal.error.message, 'attachment')
    let through = await post('article', { url: ARTICLE }, visitor)
    assertEquals(through.status, 403)
    let named = await post('api/apply', {
      entities: [{
        entity: { eid: crypto.randomUUID() },
        attachment: { blob: article.eid, name: 'mine', mime: 'text/html' },
      }],
    }, visitor)
    assertEquals(named.status, 403, await named.text())
    assertEquals((await editor.get('.attachment')).length, 1)
  } finally {
    globalThis.fetch = real
    await k.stop()
    io.removeSync(dir, { recursive: true })
  }
})

test('a manifest says who uploads with a floor the levels name', () => {
  assertEquals(appDoc({ blob: { floor: 'editor' } }).blob, { floor: 'editor' })
  let wrong = (() => {
    try {
      appDoc({ blob: { floor: 'admin', maxLength: 0 } })
    } catch (e) {
      return (e as Error).message
    }
  })()
  assertStringIncludes(wrong ?? '', 'floor is person, viewer, editor or owner')
  assertStringIncludes(wrong ?? '', 'maxLength')
})
