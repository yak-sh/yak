// A church's private directory lets its members join as viewers; the people
// it lists as former members, or as neither member nor attender, are read by
// its editors only, through a `readers` that asks a floor of the rows a query
// matches (@yaks/member asking.ts, T-159770).
import { equal, test } from '@yaks/testing'
import { connector, kernel, signIn, unique } from './probe.ts'

let k = await kernel()
let owner = await signIn(k)
let agent = connector(k, owner.cookie)
let host = `${owner.email.split('@')[0]}.${k.host}`
let app = unique('directory')
let church = `${unique('church')}.bot.yak.sh`
let txt = { type: 'string' }
await agent.tool('app_new', {
  slug: app,
  title: 'Directory',
  access: 'private',
})
await agent.tool('app_files', {
  app,
  files: [
    { path: 'index.html', content: '<h1>Members</h1>' },
    {
      path: 'vocab.json',
      content: JSON.stringify({
        join: { domain: church },
        $defs: {
          individual: {
            readers: {
              editor: '.individual.status&.individual.status!=member,attender',
            },
            properties: { first: txt, phone: txt, status: txt },
          },
        },
      }),
    },
  ],
})
await agent.tool('app_deploy', { app })
let firsts = ['Noah', 'Ada', 'Ruth', 'Kid']
await agent.tool('graph_apply', {
  app,
  entities: ['member', 'attender', 'former', undefined].map((status, i) => ({
    entity: { eid: crypto.randomUUID() },
    individual: { first: firsts[i], phone: `+1269555010${i}`, status },
  })),
})

let viewer = await signIn(k, `${unique('vi')}@${church}`)
let joined = await k.at(host, `/${app}/api/join`, {
  method: 'POST',
  headers: { cookie: viewer.cookie },
})
await joined.body?.cancel()
let read = async (cookie: string, q = '.individual') =>
  (await (await k.at(host, `/${app}/api/query?${new URLSearchParams({ q })}`, {
    headers: { cookie },
  })).json() as { entity: { eid: string }; individual: { first: string } }[])
    .map((b) => b.individual.first).sort()

test('a viewer is sent the people with no status, members and attenders', async () => {
  equal(await read(viewer.cookie), ['Ada', 'Kid', 'Noah'])
})

test('an owner is sent everyone', async () => {
  equal(await read(owner.cookie), ['Ada', 'Kid', 'Noah', 'Ruth'])
})
