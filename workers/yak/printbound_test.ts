import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { commands, parseTools } from '@yaks/tools/declared'
import { toolRow } from '@yaks/tools/result'
import printbound from '../../apps/printbound/worker.ts'
import manifest from '../../apps/printbound/vocab.json' with { type: 'json' }
import { library } from '../../apps/printbound/document_fixture.ts'
import { font } from '../../apps/printbound/font_fixture.ts'
import { platform } from './directory-rows-probe.ts'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import {
  ADA,
  ADA_OWNS,
  as,
  SECRET,
  seeded,
  visit,
} from './serving-data-probe.ts'
import { fetch as appFetch } from './apps.ts'
import { appStore } from './directory.ts'
import { declared } from './directory-fixture.ts'
import { appDoc } from './vocab.ts'
import { commandWorker, GRANT, SELF } from './dispatch.ts'
import { pdf } from './raster/pdf.ts'
import type { Env } from './env.ts'

let answer = async <T = Record<string, unknown>>(
  response: Response,
): Promise<T> => {
  let text = await response.text()
  assert(response.ok, `${response.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text || 'null') as T
}

test('a private PrintBound storefront prepares a full book and fulfills only its buyer’s reviewed edition', async () => {
  await using p = platform(SECRET)
  lifecycleStores(p.env)
  let { dir, space, app } = await seeded(p.env, 'private', p.dir)
  await dir.apply({
    entities: [{ entity: { eid: app.eid }, app: { worker: 'worker.js' } }],
  }, { ...ADA_OWNS, 'x-yak-kernel': '1' })
  app = (await dir.app(space, app.slug))!
  let customer = crypto.randomUUID(), other = crypto.randomUUID()
  await dir.apply({
    entities: [customer, other].map((eid) => ({ entity: { eid }, person: {} })),
  }, ADA_OWNS)
  let graph = appStore(p.env.STORE, space, app, p.env),
    tools = parseTools(manifest, [])
  let write = async (rows: unknown[]) =>
    answer(
      await graph('/apply', {
        method: 'POST',
        body: JSON.stringify(rows),
      }, { ...ADA_OWNS, 'x-yak-kernel': '1' }),
    )
  await answer(
    await graph('/vocab', {
      method: 'POST',
      body: JSON.stringify(appDoc(manifest)),
    }, { 'x-yak-kernel': '1' }),
  )
  await answer(
    await graph(
      '/tools',
      { method: 'POST', body: JSON.stringify(tools) },
      ADA_OWNS,
    ),
  )
  await write(commands(tools).map(toolRow))
  await declared(p.env, space, app, { vocab: manifest, tools })
  let cookies = new Map(
    await Promise.all(
      [ADA, customer, other].map(async (person) =>
        [person, await as(person)] as const
      ),
    ),
  )
  let ask = (path: string, person?: string, init: RequestInit = {}) =>
    appFetch(
      visit(`/${app.slug}/${path}`, {
        ...init,
        headers: {
          ...(person ? { cookie: cookies.get(person)! } : {}),
          ...init.headers,
        },
      }),
      p.env,
    )
  let post = <T = Record<string, unknown>>(
    path: string,
    value: unknown,
    person = customer,
  ) =>
    ask(path, person, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    }).then(answer<T>)
  let uploaded = await answer<{ eid: string }>(
    await ask(`api/pay/artifacts?buyer=${customer}`, ADA, {
      method: 'POST',
      headers: { 'content-type': 'font/ttf' },
      body: new Uint8Array(font),
    }),
  )
  await write([{
    entity: { eid: crypto.randomUUID() },
    print_service: {
      preview: true,
      product: 'text',
      margin: 0,
      contact: 'fixture@example.invalid',
      font: uploaded.eid,
    },
  }])
  let calls: number[] = [], renders = 0
  p.env.RASTER = {
    fetch: (req: Request) => {
      renders++
      return pdf(req, library)
    },
  } as Env['RASTER']
  p.env.DISPATCH = {
    get: () => ({
      fetch: async (request: Request) => {
        let operations = 0
        let binding = (grant: string) => ({
          fetch: (path: string, init: RequestInit = {}) => {
            operations++
            return appFetch(
              visit(`/${app.slug}/api/${path.replace(/^\//, '')}`, {
                ...init,
                headers: { ...init.headers, [GRANT]: grant },
              }),
              p.env,
            )
          },
        })
        let headers = new Headers(request.headers)
        headers.delete(GRANT)
        headers.delete(SELF)
        try {
          return await printbound.fetch(new Request(request, { headers }), {
            APP: binding(request.headers.get(SELF)!),
            STORE: binding(request.headers.get(GRANT)!),
            FILES: {
              fetch: () =>
                Promise.resolve(new Response('Public storefront fixture')),
            },
          })
        } finally {
          calls.push(operations)
        }
      },
    }),
  } as Env['DISPATCH']
  let read = <T>(q: string) =>
    graph('/query?q=' + encodeURIComponent(q), {}, ADA_OWNS).then(answer<T[]>)
  let drive = async () => {
    let rows = await read<
      {
        entity: { eid: string }
        call: { to: string; args?: Record<string, unknown>; source?: string }
      }
    >('.call&?call')
    for (let row of rows) {
      let [target] = await read<{ tool: { name: string } }>(
        `.entity.eid=${row.call.to}&?tool`,
      )
      if (!target?.tool || !tools[target.tool.name]?.worker) continue
      await answer(
        await commandWorker(
          p.env,
          space,
          app,
          { person: app.eid, role: 'editor' },
          tools[target.tool.name].worker!,
          row.call.args ?? {},
          { call: row.entity.eid, source: row.call.source },
        ),
      )
    }
  }
  assertEquals((await ask('privacy')).status, 200)
  assertEquals((await ask('api/query?q=.doc', customer)).status, 403)
  let source = await post<{ entity: { eid: string } }>('studio/save', {
    title: 'ABC',
    author: 'DEF',
    markdown: '# ABC\n\nA complete book.',
  })
  let id = source.entity.eid
  assertEquals((await ask(`studio/book?id=${id}`, other)).status, 403)
  type Document = {
    id: string
    pending?: boolean
    revision: string
    pages: { blob: string }[]
    interior: { blob: string; pages: number }
  }
  let document = await post<Document>('studio/prepare', { id })
  assertEquals(document.pending, true)
  assertEquals(document.revision, undefined)
  for (let n = 0; document.pending && n < 30; n++) {
    await drive()
    document = await post<Document>('studio/preparation', { id })
  }
  assertEquals(document.pending, false)
  assertEquals(document.interior.pages, 32)
  assertEquals(document.pages.length, 33)
  assertEquals(renders, 33)
  assert(Math.max(...calls) <= 20)
  let preview = await ask(
    `studio/file?id=${id}&blob=${document.pages[0].blob}`,
    customer,
  )
  assertEquals(preview.status, 200)
  await preview.body?.cancel()
  assertEquals(
    (await ask(`api/pay/artifacts/${document.interior.blob}`, other)).status,
    404,
  )
  let quote = await post<{ document: string }>('studio/quote', {
    id,
    quantity: 1,
    shipping: 'MAIL',
    address: {
      name: 'Ana',
      street1: '1 Sample St',
      city: 'Sample',
      state_code: 'NY',
      country_code: 'US',
      postcode: '10001',
      phone_number: '5555555555',
    },
  })
  assertEquals(quote.document, document.id)
  let receipt = await post<{ id: string; status: string; checkout: string }>(
    'studio/purchase',
    { id },
  )
  assert(receipt.checkout)
  assertEquals(receipt.status, 'payment_pending')
  for (let n = 0; n < 6; n++) await drive()
  assertEquals(
    (await post<{ status: string }>('studio/progress', { id })).status,
    'shipped',
  )
  assertEquals((await ask(`receipt?order=${receipt.id}`, customer)).status, 200)
  assertEquals((await ask(`receipt?order=${receipt.id}`, other)).status, 403)
})
