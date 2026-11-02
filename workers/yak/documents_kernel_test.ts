import {
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
} from '@std/assert'
import { test } from '@yaks/testing'
import { hashEmbedder } from '@yaks/embedding'
import { modelPage } from './testing.ts'
import { DIM, MODEL } from './embedding.ts'
import { ADA, as, platform, seeded, visit } from './serving-probe.ts'
import { fetch } from './apps.ts'
import { appStore } from './directory.ts'
import { KERNEL, metaOf } from './meta.ts'

let vectors = hashEmbedder(DIM), ocr = 0, answered = 0
let p = platform({
  AI: {
    gateway: () => ({ getUrl: () => Promise.resolve('') }),
    run: async (model, input) => {
      if (model == MODEL) {
        return {
          data: await Promise.all(
            (input as { text: string[] }).text.map((s) =>
              Promise.resolve(vectors.embed(s)).then((v) => [...v])
            ),
          ),
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        }
      }
      let req = input as { messages: { content: unknown }[] }
      if (Array.isArray(req.messages[0].content)) {
        ocr++
        return {
          response: 'A new fire engine costs 500 dollars.',
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }
      }
      answered++
      let { sources } = JSON.parse(String(req.messages[1].content))
      return {
        response: JSON.stringify({
          answer: 'The fire engine costs 500 dollars (Minutes.pdf, Page 2).',
          citations: [
            sources.find((s: { location: string }) => s.location == 'Page 2')
              .source,
          ],
        }),
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      }
    },
  },
  RASTER: {
    fetch: (req) =>
      Promise.resolve(
        Response.json(
          new URL(req.url).searchParams.has('page')
            ? {
              pages: 2,
              text: 'The zoning board meets on Tuesday.',
              ...(new URL(req.url).searchParams.get('page') == '2'
                ? { image: 'scan' }
                : {}),
            }
            : { pages: 2 },
        ),
      ),
  },
  MODEL_FETCH: () =>
    Promise.resolve(
      modelPage(0.1, 0.3),
    ),
})
let { dir, space, app } = await seeded(p.env, 'private')
let cookie = await as(ADA), root = '/cookbook/api/'
let send = (path: string, body: unknown, member = true) =>
  fetch(
    visit(root + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(member ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    p.env,
  )
let upload = () =>
  fetch(
    visit(root + 'blob', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/pdf',
        'x-yak-name': 'Minutes.pdf',
      },
      body: '%PDF-1.4\n%%EOF',
    }),
    p.env,
  )
let first = await upload()
assertEquals(first.status, 200)
let file = await first.json()
await p.settled()
let door = appStore(p.env.STORE, space, app, p.env), g = metaOf(door, KERNEL)
let pages = await g.query('.document_page&*', { trusted: true })
let receipt = await g.query('.document_text&*', { trusted: true })
let initialCalls = ocr
await upload()
await p.settled()
let repeatedCalls = ocr
let fts = await send('documents/search', { words: 'engine' })
let ftsHits = await fts.json()
let response = await send('documents/ask', { words: 'fire engine costs' })
let answer = await response.json()
let spent = (await dir.space('ada'))!.meter!.models!
await dir.apply({
  entities: [{ entity: { eid: app.eid }, app: { access: 'public' } }],
}, { 'x-yak-role': 'owner' })
let before = answered
let denied = await send('documents/ask', { words: 'fire engine costs' }, false)
let deniedMeaning = await send('documents/search', {
  words: 'engine',
  semantic: true,
}, false)

test('upload extraction is durable, automatic and repeated uploads reuse it', () => {
  assertEquals(pages.length, 2)
  assertEquals(receipt.length, 1)
  assertEquals(initialCalls, 1)
  assertEquals(repeatedCalls, 1)
  assertEquals((file as { mime: string }).mime, 'application/pdf')
})

test('a private app searches and answers with page citations through its public API', () => {
  assertEquals(fts.status, 200, JSON.stringify(ftsHits))
  assertEquals(ftsHits.map((h: { page: number }) => h.page), [2])
  assertEquals(response.status, 200, JSON.stringify(answer))
  assertStringIncludes(answer.answer, '500 dollars')
  assertEquals(answer.citations[0].document.name, 'Minutes.pdf')
  assertEquals(answer.citations[0].page, 2)
  assertAlmostEquals(spent, (100 * 0.1 + 20 * 0.3 + 200 * 0.1 + 30 * 0.3) / 1e6)
})

test('read-only visitors cannot spend on semantic retrieval or answers with closed models', () => {
  assertEquals(denied.status, 401)
  assertEquals(deniedMeaning.status, 401)
  assertEquals(answered, before)
})
