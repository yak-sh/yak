// Two hosts as one reach, each a graph in this process behind @yaks/mcp's own
// door, handed over as the member's `fetch`: the shop sells the books, the
// lender keeps the loans, and nothing opens a socket.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { mcp } from '@yaks/mcp'
import { ram } from '@yaks/ram'
import { reach } from '@yaks/reach'
import { loadVocab } from '@yaks/vocab'
import { shop, shopGraph } from '../mcp/testing.ts'
import { hostDoor, hostMember } from './member.ts'
import { doorUrl, rpc } from './rpc.ts'

let lender = loadVocab([...shop.docs, {
  title: 'lender',
  $defs: {
    loan: {
      component: true,
      type: 'object',
      properties: { to: { type: 'string' } },
    },
  },
}])

let host = (at: string, g = shopGraph()) => {
  let door = mcp({ graph: g })
  return hostMember(at, rpc({ url: doorUrl(at), fetch: (r) => door(r) }))
}

let hosts = () => [
  host('shop.test'),
  {
    ...host('lend.test', graph({ storage: ram(lender), vocab: lender })),
    remote: true,
  },
]

// Hosts share no core: every word is one a host declares, so `book` is the
// shop's, its first declarer, though the lender speaks it too.
let fan = reach({ core: loadVocab([]) })
let dune = { eid: crypto.randomUUID() }

test('a write across two hosts lands each component where its word lives, and reads back as one bundle', async () => {
  let members = hosts()
  let { where } = await fan.written(members, undefined, [
    {
      entity: dune,
      book: { price: 9, status: 'shelved' },
      loan: { to: 'Ann' },
    },
  ])
  equal(where, 'shop.test and lend.test')
  let [book] = await fan.read(members, '.book&?loan') as Record<
    string,
    unknown
  >[]
  equal([book.book, book.loan, book._stores], [
    { price: 9, status: 'shelved' },
    { to: 'Ann' },
    { book: 'shop.test', loan: 'lend.test' },
  ])
  equal(await fan.read(members, '.book&.loan&.count'), { count: 1 })
  equal(await members[0].read('.loan'), [])
})

test('a row only another host holds says so, its number included', async () => {
  let members = hosts()
  let kim = { eid: crypto.randomUUID() }
  await fan.written(members, undefined, [{ entity: kim, loan: { to: 'Bo' } }])
  let [row] = await fan.read(members, '.loan') as Record<string, unknown>[]
  equal(row._stores, { loan: 'lend.test', entity: 'lend.test' })
})

test('a rehearsed write keeps nothing on any host', async () => {
  let members = hosts()
  await fan.written(members, undefined, [
    { entity: dune, book: { price: 9 }, loan: { to: 'Ann' } },
  ], { check: true })
  equal(await fan.read(members, '.book&.count'), { count: 0 })
})

test('a host refusing a write says why', async () => {
  let [shopHost] = hosts()
  let refused = await shopHost.apply(
    [{ entity: dune, loan: { to: 'Ann' } }],
    false,
  )
    .then(() => '', (e: Error) => e.message)
  equal(refused.includes('loan'), true)
})

test('only the host the line aims at hears $YAKS_TOKEN and --as', async () => {
  let asked: [string, string | undefined, string | undefined][] = []
  let door = (at: string) =>
    hostDoor(at, {
      aimed: 'yaks.app',
      as: 'bot',
      env: (n) => n == 'YAKS_TOKEN' ? 'sandbox' : undefined,
      fetch: () => Response.json({ jsonrpc: '2.0', id: 1, result: {} }),
      token: (host, _state, o) => {
        asked.push([host, o?.env?.('YAKS_TOKEN'), o?.as])
        return Promise.resolve(null)
      },
    })('ping')
  await door('yaks.app')
  await door('box.test')
  equal(asked, [
    ['yaks.app', 'sandbox', 'bot'],
    ['box.test', undefined, undefined],
  ])
})
