// A page's graph doors: a query reaches its own store once, and the
// vocabulary door passes a Store refusal through to its caller.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { App, Space } from './directory.ts'
import { type Door, USES } from './door.ts'
import { queryFrom, vocabularyAnswer } from './page-graph.ts'

let space = { slug: 'page-words' } as Space
let app = {
  eid: 'page',
  slug: 'page',
  access: 'public',
  home: false,
  store: null,
  version: 1,
} as App
// The store's consume boundary supplies decoded rows without a runtime body
// stream. Every request, including a fallback, still passes through this door.
let door = (answers: Response[]) => {
  let asked: string[] = []
  let store: Door = Object.assign(
    () => {
      throw new Error('a response must be consumed')
    },
    {
      consume: async <T>(
        path: string,
        read: (response: Response) => T | Promise<T>,
      ) => {
        asked.push(path)
        return await read(answers.shift()!)
      },
    },
  )
  return { store, asked }
}
let answer = (rows: unknown, uses?: string, status = 200) => {
  let cancelled = false
  return {
    response: {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(uses === undefined ? {} : { [USES]: uses }),
      body: {
        cancel: () => {
          cancelled = true
          return Promise.resolve()
        },
      },
      json: () => Promise.resolve(rows),
    } as unknown as Response,
    cancelled: () => cancelled,
  }
}
let unexpectedHome = () => {
  throw new Error('own words have no home to read')
}

let titles = (rows: unknown) =>
  (rows as { doc: { title: string } }[]).map((r) => r.doc.title)

let failed = { error: 'Refused', message: 'schema held' }
let refusedVocabulary = Response.json(failed, { status: 503 })
test('page vocabulary preserves a Store refusal', async () => {
  let { failed: response } = await vocabularyAnswer(refusedVocabulary, {
    request: 'GET /api/vocab.json',
    space: space.slug,
    app: app.slug,
  })
  if (!response) throw new Error('the refusal became vocabulary')
  assertEquals(response.status, 503)
  assertEquals(await response.json(), failed)
})

let rows = [{ entity: { eid: 'n' }, doc: { title: 'Hi' } }]
let own = door([answer(rows, '{}').response])
test('a page query of its own words reaches its store once', async () => {
  assertEquals(titles(await queryFrom(own.store, '.doc', unexpectedHome)), [
    'Hi',
  ])
  assertEquals(own.asked, ['/query?q=.doc&listing=1&uses=1'])
})

// An older store says which words it uses only at `/uses`.
let unmarked = answer(rows)
let legacy = door([
  unmarked.response,
  answer({}).response,
  answer(rows).response,
])
test('a page query answers from a store that does not say its uses', async () => {
  assertEquals(titles(await queryFrom(legacy.store, '.doc', unexpectedHome)), [
    'Hi',
  ])
  assertEquals(legacy.asked, [
    '/query?q=.doc&listing=1&uses=1',
    '/uses',
    '/query?q=.doc&listing=1',
  ])
  assertEquals(unmarked.cancelled(), true)
})

let homed = door([answer(null, '{"recipe":"cookbook"}', 204).response])
test('a page query of borrowed words follows the homes its store names', async () => {
  let named: Record<string, string> | undefined
  let result = await queryFrom(homed.store, '.recipe', (uses) => {
    named = uses
    return Promise.resolve(rows)
  })
  assertEquals(result, rows)
  assertEquals(named, { recipe: 'cookbook' })
  assertEquals(homed.asked, ['/query?q=.recipe&listing=1&uses=1'])
})
