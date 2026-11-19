// Joining a private app whose own rows list you (join.ts, T-135365): the
// church directory's members sign in with the address it holds for them and
// press Join; nobody else is offered anything.
import { equal, ok, test } from '@yaks/testing'
import { connector, kernel, signIn, unique } from './probe.ts'

let k = await kernel()
let owner = await signIn(k)
let agent = connector(k, owner.cookie)
let host = `${owner.email.split('@')[0]}.${k.host}`
let app = unique('directory')
let church = `${unique('church')}.bot.yak.sh`
let vocab = {
  join: {
    emails: ['individual.email', 'household.email'],
    domain: church,
  },
  $defs: {
    individual: {
      properties: {
        first: { type: 'string' },
        email: { type: 'string' },
      },
    },
    household: { properties: { email: { type: 'string' } } },
  },
}
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
      content: JSON.stringify(vocab),
    },
  ],
})
await agent.tool('app_deploy', { app })

let person = () => signIn(k, `${unique('member')}@bot.yak.sh`)
let listing = async (email: string) => {
  let eid = crypto.randomUUID()
  await agent.tool('graph_apply', {
    app,
    entities: [{ entity: { eid }, individual: { first: 'Ann', email } }],
  })
  return eid
}
let page = (cookie: string) =>
  k.at(host, `/${app}/`, { headers: { cookie }, redirect: 'manual' })
let press = (cookie: string) =>
  k.at(host, `/${app}/api/join`, {
    method: 'POST',
    headers: { cookie, accept: 'text/html' },
    redirect: 'manual',
  })
let me = async (cookie: string) =>
  (await (await k.at(host, `/${app}/api/who`, { headers: { cookie } })).json())
    .join

test('a person the rows list presses Join once and is in', async () => {
  let ana = await person()
  // Written as a secretary types it: capitals, and a second address beside it.
  await listing(`${ana.email.toUpperCase()}, spouse@example.org`)
  let shut = await page(ana.cookie)
  let said = await shut.text()
  equal(shut.status, 403)
  ok(said.includes('Join Directory'), said)
  ok(said.includes(`action="/${app}/api/join"`), said)
  equal(await me(ana.cookie), 'viewer')

  let joined = await press(ana.cookie)
  await joined.body?.cancel()
  equal([joined.status, joined.headers.get('location')], [303, `/${app}/`])
  let open = await page(ana.cookie)
  equal(open.status, 200)
  ok((await open.text()).includes('<h1>Members</h1>'))
  equal(await me(ana.cookie), null)
})

test('nobody the rows leave out is offered Join, or let in by asking', async () => {
  let bo = await person()
  let shut = await page(bo.cookie)
  equal(shut.status, 404)
  ok(!(await shut.text()).includes('Join'))
  equal(await me(bo.cookie), null)
  let asked = await press(bo.cookie)
  equal(asked.status, 403)
  equal((await asked.json()).error.code, 'not_listed')
  equal((await page(bo.cookie)).status, 404)
})

test('a row taken away stops its person joining', async () => {
  let cy = await person()
  let row = await listing(cy.email)
  equal(await me(cy.cookie), 'viewer')
  await agent.tool('graph_apply', {
    app,
    entities: [{ entity: { eid: row }, $delete: true }],
  })
  equal(await me(cy.cookie), null)
  let asked = await press(cy.cookie)
  await asked.body?.cancel()
  equal(asked.status, 403)
})

test('an address at the domain joins without a row', async () => {
  let di = await signIn(k, `${unique('di')}@${church}`)
  let joined = await k.at(host, `/${app}/api/join`, {
    method: 'POST',
    headers: { cookie: di.cookie },
  })
  equal(await joined.json(), { joined: 'viewer' })
  equal((await page(di.cookie)).status, 200)
})

test('the installer sets the join policy and keeps it through updates', async () => {
  let offer = unique('roster')
  await agent.tool('app_publish', { app, name: offer })
  let installer = await signIn(k)
  let theirs = connector(k, installer.cookie)
  let at = `${installer.email.split('@')[0]}.${k.host}`
  await theirs.tool('app_install', { name: offer, as: app })
  let ask = async (cookie: string) =>
    (await (await k.at(at, `/${app}/api/who`, { headers: { cookie } }))
      .json()).join
  let contents = () =>
    theirs.tool('app_files', { app, op: 'read', path: 'vocab.json' })
  ok(!(await contents()).includes('"join"'))
  let stranger = await signIn(k, `${unique('pub')}@${church}`)
  equal(await ask(stranger.cookie), null)
  let pressed = await k.at(at, `/${app}/api/join`, {
    method: 'POST',
    headers: { cookie: stranger.cookie },
  })
  equal(pressed.status, 403)

  let mine = `${unique('flock')}.bot.yak.sh`
  await theirs.tool('app_set', { app, join: { domain: mine, role: 'editor' } })
  equal(await ask(stranger.cookie), null)
  let member = await signIn(k, `${unique('ann')}@${mine}`)
  equal(await ask(member.cookie), 'editor')

  let other = `${unique('other')}.bot.yak.sh`
  await agent.tool('app_files', {
    app,
    files: [{
      path: 'vocab.json',
      content: JSON.stringify({ ...vocab, join: { domain: other } }),
    }],
  })
  await agent.tool('app_deploy', { app })
  await agent.tool('app_publish', { app, name: offer })
  await theirs.tool('app_update', { app })
  ok(!(await contents()).includes('"join"'))
  let outsider = await signIn(k, `${unique('pub')}@${other}`)
  equal(await me(outsider.cookie), 'viewer')
  equal(await ask(outsider.cookie), null)
  equal(await ask(member.cookie), 'editor')

  let joined = await k.at(at, `/${app}/api/join`, {
    method: 'POST',
    headers: { cookie: member.cookie },
  })
  equal(await joined.json(), { joined: 'editor' })
  await theirs.tool('app_set', { app, join: {} })
  let later = await signIn(k, `${unique('later')}@${mine}`)
  equal(await ask(later.cookie), null)
  equal(
    (await k.at(at, `/${app}/`, { headers: { cookie: member.cookie } })).status,
    200,
  )
})
