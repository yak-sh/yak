import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import * as preact from 'preact'
import { nativeOf, store, Unloadable, viewAt } from './remote.ts'

let APP = 'https://a.yaks.app/trip/'

// A fetch answering from files by URL, and what it was asked.
let served = (files: Record<string, string>) => {
  let asked: string[] = []
  let go = ((input: RequestInfo | URL, init?: RequestInit) => {
    let url = String(input instanceof Request ? input.url : input)
    asked.push(`${init?.method ?? 'GET'} ${url} ${init?.body ?? ''}`.trim())
    let body = files[url]
    return Promise.resolve(
      body == null
        ? new Response('{"message":"no such row"}', { status: 404 })
        : new Response(body),
    )
  }) as typeof fetch
  return { go, asked }
}

test('a page names its view, which loads with what it imports', async () => {
  let { go } = served({
    [APP]: '<base href="/trip/"><link rel="yaks-native" href="view.ts">',
    [`${APP}view.ts`]: "import { h } from 'preact'\n" +
      "import { word } from './lib/word.ts'\n" +
      'export default (p: { store: unknown }) => h("p", {}, word)',
    [`${APP}lib/word.ts`]: "export let word: string = 'packed'",
  })
  let url = await nativeOf(APP, go)
  assertEquals(url, `${APP}view.ts`)
  let View = await viewAt(url!, { preact }, go)
  let p = (View as preact.FunctionComponent)({}) as preact.VNode
  assertEquals([p.type, p.props.children], ['p', 'packed'])
  assertEquals(await nativeOf(`${APP}gone/`, go), null)
})

test('a view importing what the host does not carry is not loaded', async () => {
  let { go } = served({
    [`${APP}view.ts`]: "import * as three from 'three'\nexport default three",
    [`${APP}none.ts`]: 'export let x = 1',
  })
  for (let [file, said] of [['view.ts', 'three'], ['none.ts', 'no default']]) {
    await assertRejects(
      () => viewAt(`${APP}${file}`, { preact }, go),
      Unloadable,
      said,
    )
  }
})

test("an app's store reads and writes over HTTP, saying a refusal", async () => {
  let { go, asked } = served({ [`${APP}api/query?.bring`]: '[{"n":1}]' })
  let rows = store(`${APP}api`, go)
  assertEquals(await rows.query('.bring'), [{ n: 1 }])
  await assertRejects(() => rows.apply([{ bring: {} }]), Error, 'no such row')
  assertEquals(asked, [
    `GET ${APP}api/query?.bring`,
    `POST ${APP}api/apply {"entities":[{"bring":{}}]}`,
  ])
})
