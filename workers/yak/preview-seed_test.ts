// A first release seeds the live rows even when its draft's preview already
// wrote the same seed on its branch: main holds only a bare spine of an
// entity a branch made, which is nobody's row (app-declarations.ts `unseeded`).
import { cleanup, equal, ok, test } from '@yaks/testing'
import { client, connector, fresh, seed } from './probe.ts'

let k = await fresh()
cleanup(() => k.stop())
let space = `sow${crypto.randomUUID().slice(0, 8)}`
let owner = await seed(k, [{ slug: space, apps: ['decks'] }])
let agent = connector(k, owner.cookie)
let host = `${space}.${k.host}`

let app = 'decks', eid = crypto.randomUUID(), word = 'deck'
test('a first deploy after a preview seeds a fixed-eid seed row into the live rows', async () => {
  await agent.tool('app_files', {
    space,
    app,
    files: [
      { path: 'index.html', content: '<html><body>Decks</body></html>' },
      {
        path: 'vocab.json',
        content: JSON.stringify({
          $defs: { [word]: { properties: { text: { type: 'string' } } } },
        }),
      },
      {
        path: 'seed.json',
        content: JSON.stringify([{
          entity: { eid },
          [word]: { text: 'sown' },
        }]),
      },
    ],
  })
  let link = new URL(String(
    (await agent.answer('app_preview', {
      space,
      app,
      screenshot: false,
    })).value!.url,
  ))
  let texts = (rows: Record<string, unknown>[]) =>
    rows.map((r) => (r[word] as { text: string }).text)
  let shown = await k.at(link.host, `${link.pathname}api/query?q=.${word}`, {
    headers: { cookie: owner.cookie },
  })
  equal(texts(await shown.json()), ['sown'])
  let said = await agent.tool('app_deploy', { space, app })
  ok(said.includes('seeded 1 entity'), said)
  equal(texts(await client(k, host, app, owner.cookie).get(`.${word}`)), [
    'sown',
  ])
})
