import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { connector, kernel, signIn, txt, unique, vocabFile } from './probe.ts'

let k = await kernel()
let giver = await signIn(k)
let recipient = await signIn(k)
let bystander = await signIn(k)
let source = await k.dir.own(giver.person)
let target = await k.dir.own(recipient.person)
let unrelated = await k.dir.own(bystander.person)
let his = connector(k, giver.cookie)
let hers = connector(k, recipient.cookie)
let slug = unique('transfer')
let original = { space: source.slug, app: slug }
let moved = { space: target.slug, app: slug }
let updates = `/manage/${target.slug}/updates`
let html =
  '<!doctype html><h1>Transfer fixture</h1><script src="./app.js"></script>'
let code = 'console.log("kept release")'
let row = crypto.randomUUID()
await his.tool('app_new', {
  ...original,
  slug,
  title: 'Transfer fixture',
  access: 'private',
})
for (
  let [path, content] of Object.entries({
    'index.html': html,
    'app.js': code,
    'vocab.json': vocabFile({ note: { text: txt } }),
  })
) {
  await his.tool('app_files', { ...original, op: 'write', path, content })
}
await his.tool('app_deploy', original)
await his.tool('app_publish', { ...original, name: slug, demo: false })
await his.tool('graph_apply', {
  ...original,
  entities: [{ entity: { eid: row }, note: { text: 'kept row' } }],
})
await hers.tool('app_new', {
  space: target.slug,
  slug: 'unrelated',
  title: 'Unrelated',
  access: 'private',
})
let app = (await k.dir.app(source, slug))!
let offer = { ...original, email: recipient.email, editor: true }
let offered = await his.answer('app_transfer', offer)
let transfer = String(offered.value?.transfer)
let accept = (cookie: string, answer: string, at = updates) =>
  k.at(k.host, at, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ transfer, answer }).toString(),
  })

test('an owner transfers the same private app on the named recipient’s acceptance', async () => {
  assertEquals(
    (await his.answer('app_transfer', offer)).value?.transfer,
    transfer,
  )
  assertEquals((await k.dir.appAt(app.eid))?.space.eid, source.eid)
  assertEquals(await k.dir.app(target, slug), null)
  let card = await k.at(k.host, updates, {
    headers: { cookie: recipient.cookie },
  })
  assertEquals(card.status, 200)
  let page = await card.text()
  assertStringIncludes(page, transfer)
  assertStringIncludes(page, 'Accept and keep editor')
  let outsider = await accept(
    bystander.cookie,
    'accept',
    `/manage/${unrelated.slug}/updates`,
  )
  assertEquals(
    outsider.status >= 400 && outsider.status < 500,
    true,
    await outsider.text(),
  )
  let accepted = await accept(recipient.cookie, 'accept-with-editor')
  assertEquals(accepted.status, 303, await accepted.text())
  assertEquals(
    (await accept(recipient.cookie, 'accept-with-editor')).status,
    303,
  )
  let after = (await k.dir.app(target, slug))!
  assertEquals(after.eid, app.eid)
  assertEquals(after.store, app.store)
  assertEquals(after.source, app.source)
  assertEquals(after.published, app.published)
  assertEquals(await k.dir.app(source, slug), null)
  assertEquals((await k.dir.departedApps(source)).map((a) => a.eid), [app.eid])
  assertStringIncludes(
    await hers.tool('graph_query', { ...moved, filter: `.entity.eid=${row}` }),
    'kept row',
  )
  assertStringIncludes(
    await hers.tool('app_files', { ...moved, op: 'read', path: 'app.js' }),
    code,
  )
  assertStringIncludes(
    await hers.tool('app_versions', moved),
    'v1 (live) (offered)',
  )
  let redirected = await k.at(`${source.slug}.${k.host}`, `/${slug}/app.js`)
  assertEquals(redirected.status, 302)
  assertStringIncludes(
    redirected.headers.get('location')!,
    `${target.slug}.${k.host}/${slug}/app.js`,
  )
  await his.tool('app_files', {
    ...moved,
    op: 'write',
    path: 'extra.txt',
    content: 'editor write',
  })
  await his.tool('app_deploy', moved)
  assertStringIncludes(await hers.tool('app_versions', moved), 'v2 (live)')
  await assertRejects(() =>
    his.tool('app_files', { ...moved, app: 'unrelated', op: 'list' })
  )
  await assertRejects(() =>
    his.tool('app_transfer', { ...moved, email: bystander.email })
  )
})
