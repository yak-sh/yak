// A public app's consent and notice delivery, through the kernel with captured mail.
import { equal, ok, test } from '@yaks/testing'
import { derivedEid } from '@yaks/graph/identity'
import { connector, kernel, letters, meta, signIn } from './probe.ts'

let k = await kernel()
let owner = await signIn(k)
let agent = connector(k, owner.cookie)
let space = owner.email.split('@')[0]
let host = `${space}.${k.host}`
let app = `notices${crypto.randomUUID().slice(0, 6)}`
let made = await agent.answer('app_new', {
  slug: app,
  title: 'Town notices',
  access: 'open',
})
let appEid = String(made.value?.eid)
let vocabulary = (history = false) =>
  JSON.stringify({
    $defs: {
      town_notice: { notice: true, properties: {} },
      meeting_notice: { notice: true, properties: {} },
      historic_notice: { notice: history, properties: {} },
    },
  })
await agent.tool('app_files', {
  app,
  op: 'write',
  path: 'vocab.json',
  content: vocabulary(),
})
await agent.tool('app_files', {
  app,
  op: 'write',
  path: 'index.html',
  content: '<h1>Town notices</h1>',
})
await agent.tool('app_deploy', { app })
let path = `/${app}/api/`
let apply = (entities: unknown[]) =>
  agent.tool('graph_apply', { app, entities })
let draft = crypto.randomUUID()
let history = crypto.randomUUID()
await apply([
  { entity: { eid: draft }, doc: { title: 'Meeting draft' } },
  {
    entity: { eid: history },
    historic_notice: {},
    doc: { title: 'Historic notice' },
  },
])
let subscribe = (email: string) =>
  k.at(host, `${path}notices/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
let click = (url: string) => {
  let u = new URL(url)
  return k.at(u.host, u.pathname + u.search)
}
let links = (body: string, action: string) =>
  body.match(
    new RegExp(`https://[^\\s)]+/api/notices/${action}\\?t=[^\\s)]+`),
  )![0]
let addresses = ['confirmed', 'pending', 'left'].map((name) =>
  `${name}-${app}@example.com`
)
for (let address of addresses) {
  for (
    let response of await Promise.all([subscribe(address), subscribe(address)])
  ) equal(response.status, 200)
}
await k.settled()
let confirms = addresses.map((address) => letters(k, address)[0])
for (let i of [0, 2]) {
  equal((await click(links(confirms[i].body, 'confirm'))).status, 200)
}
equal((await click(links(confirms[2].body, 'unsubscribe'))).status, 200)
await agent.tool('app_files', {
  app,
  op: 'write',
  path: 'vocab.json',
  content: vocabulary(true),
})
await agent.tool('app_deploy', { app })

test('a posted notice reaches only confirmed subscribers, and every letter unsubscribes in one click', async () => {
  await apply([{
    entity: { eid: history },
    doc: { title: 'Historic notice corrected' },
  }])
  await k.settled()
  equal(addresses.map((address) => letters(k, address).length), [1, 1, 1])
  let eid = draft
  let notice = {
    entity: { eid },
    town_notice: {},
    meeting_notice: {},
    doc: { title: 'Meeting Tuesday', body: 'The meeting begins at 7pm.' },
  }
  await apply([notice])
  await k.settled()
  equal(addresses.map((address) => letters(k, address).length), [2, 1, 1])
  let received = letters(k, addresses[0])[1]
  equal(received.subject, 'Meeting Tuesday')
  ok(received.body.includes('The meeting begins at 7pm.'))
  await apply([{ entity: { eid }, town_notice: null }])
  await apply([notice])
  await k.settled()
  equal(letters(k, addresses[0]).length, 2)
  equal((await click(links(received.body, 'unsubscribe'))).status, 200)
  equal((await click(links(received.body, 'unsubscribe'))).status, 200)
  equal((await click(links(confirms[0].body, 'confirm'))).status, 400)
  await apply([{
    entity: { eid: crypto.randomUUID() },
    town_notice: {},
    doc: { title: 'Next meeting' },
  }])
  await k.settled()
  equal(letters(k, addresses[0]).length, 2)
  // Updating the original notice cannot send it again.
  await apply([{ ...notice, doc: { title: 'Meeting Tuesday, updated' } }])
  await k.settled()
  equal(letters(k, addresses[0]).length, 2)
})

test('a public query reveals neither subscription addresses nor their private letters', async () => {
  for (let q of ['.notice_subscription&*', '.notice_letter&*']) {
    let r = await k.at(host, `${path}query?${encodeURIComponent(q)}`)
    equal(r.status, 200)
    equal(await r.json(), [])
  }
})

test('visitors cannot forge consent, alter another subscription, or post a notice', async () => {
  let token = new URL(links(confirms[1].body, 'confirm'))
  token.searchParams.set('t', token.searchParams.get('t') + 'x')
  equal((await click(token.href)).status, 400)
  // The deterministic identity can be known; possession of it grants nothing.
  let eid = derivedEid(
    JSON.stringify(['notice_subscription', appEid, addresses[1]]),
  )
  for (
    let row of [
      { entity: { eid }, notice_confirmed: {} },
      { entity: { eid: crypto.randomUUID() }, notice_confirmed: {} },
      { entity: { eid: crypto.randomUUID() }, notice_subscription: {} },
      { entity: { eid }, email: { address: 'other@example.com' } },
      {
        entity: { eid: crypto.randomUUID() },
        town_notice: {},
        doc: { title: 'Forged notice' },
      },
    ]
  ) {
    let r = await k.at(host, `${path}apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([row]),
    })
    ok(r.status >= 400, await r.text())
  }
  await k.settled()
  equal(letters(k, addresses[1]).length, 1)
})

test('confirmation and notice letters count against the space’s existing email allowance', async () => {
  let { value } = await agent.answer('app_list')
  let spaces = value!.spaces as {
    slug: string
    standing: { limits: { emails: { used: number; limit: number } } }
  }[]
  equal(spaces.find((s) => s.slug == space)!.standing.limits.emails, {
    used: 4,
    limit: 100,
  })
})

test('a confirmation over the monthly allowance is kept as a bounce and sends no letter', async () => {
  let directory = meta(k)
  let [row] = await directory.query(`.space.slug=${space}`)
  await directory.apply([{
    entity: row.entity,
    meter: { month: new Date().toISOString().slice(0, 7), emails: 100 },
  }])
  let address = `over-${app}@example.com`
  equal((await subscribe(address)).status, 200)
  await k.settled()
  equal(letters(k, address).length, 0)
  // Administrative reads of the private mailbox retain the failed delivery.
  let admin = connector(k, k.owner.cookie)
  let result = await admin.answer('graph_query', {
    space,
    app,
    query: '.notice_letter .bounced ?doc',
  })
  let rows = result.rows as unknown as { bounced: { reason: string } }[]
  ok(
    rows?.some((r) => r.bounced.reason.includes('100 emails a month')),
    JSON.stringify(result),
  )
})
