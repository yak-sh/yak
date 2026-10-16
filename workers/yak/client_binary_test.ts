// The actual public page client keeps native bytes across its outbox and
// interprets receipts/query answers only through the app's vocabulary.
import { equal, test } from '@yaks/testing'
import { stub } from '@std/testing/mock'
import { store } from './public/client.js'
import { stringify } from '@yaks/vocab/wire'

let data = new Uint8Array([0, 255, 128])
let literal = { $bytes: '00ff80', encoding: 'hex' }
let row = { entity: { eid: 'p' }, payload: { data, json: literal } }
let docs = [{
  $defs: {
    payload: {
      component: true,
      properties: {
        data: { type: 'string', contentEncoding: 'base64' },
        json: { type: 'object' },
      },
    },
  },
}]
let json = (value: unknown) => Promise.resolve(new Response(stringify(value)))

test('public client apply and query return Uint8Array, leaving legacy JSON tags untouched', async () => {
  let requests: string[] = []
  using _fetch = stub(globalThis, 'fetch', (url, init) => {
    let path = new URL(String(url)).pathname.split('/').at(-1)!
    requests.push(path)
    if (path == 'me') return json({ person: 'binary-owner' })
    if (path == 'vocab.json') return json(docs)
    if (path == 'apply') {
      equal(JSON.parse(String(init?.body)).entities[0].payload, {
        data: { $bytes: 'AP+A', encoding: 'base64' },
        json: literal,
      })
      return json({ ok: true, aliases: {}, bundles: [row] })
    }
    return json([row])
  })
  let page = store('https://binary-client.test/app/api/')
  try {
    equal((await page.apply(row)).bundles, [row])
    equal(await page.query('.payload'), [row])
    equal(requests.filter((path) => path == 'vocab.json').length, 1)
  } finally {
    page.outbox.close()
  }
})
