// Mossvale's damage command changes a hero through the same guarded store
// door as the page. Only the space owner may turn damage off.
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import words from '../../apps/vale/vocab.json' with { type: 'json' }
import { accepted, client, connector, kernel, seed, signIn } from './probe.ts'

test('the Mossvale owner turns a hero’s damage off and on', async () => {
  let k = await kernel()
  try {
    let owner = await seed(k, [{ slug: 'damagelab', apps: [] }])
    let agent = connector(k, owner.cookie)
    let at = { space: 'damagelab', app: 'vale' }
    await agent.tool('app_new', { ...at, slug: 'vale', title: 'Mossvale' })
    await agent.tool('app_files', {
      ...at,
      files: [{ path: 'vocab.json', content: JSON.stringify(words) }],
    })
    await agent.tool('app_deploy', at)

    let page = client(k, 'damagelab.yaks.app', 'vale', owner.cookie)
    let hero = crypto.randomUUID()
    await page.applied({ entities: [{ entity: { eid: hero }, player: {} }] })
    let damage = (on: boolean) =>
      agent.tool('command', {
        app: 'damagelab/vale',
        name: 'damage',
        args: { player: hero, on },
      })
    let pageDamage = (cookie: string, on: boolean) =>
      k.at('damagelab.yaks.app', '/vale/api/command', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'damage', args: { player: hero, on } }),
      })
    let state = async () =>
      (await page.get(`.entity.eid=${hero}&?damageable`))[0]?.damageable

    let protectedHero = await pageDamage(owner.cookie, false)
    assertEquals(protectedHero.status, 200, await protectedHero.text())
    assertEquals(await state(), { on: false })

    let editor = await signIn(k)
    await agent.tool('member_add', {
      space: 'damagelab',
      email: editor.email,
      role: 'editor',
    })
    await accepted(k, editor.email, editor.cookie)
    let another = connector(k, editor.cookie)
    let refused = await assertRejects(() =>
      another.tool('command', {
        app: 'damagelab/vale',
        name: 'damage',
        args: { player: hero, on: true },
      })
    )
    assert(refused instanceof Error)
    assertStringIncludes(refused.message, 'damage requires the app owner')
    let pageRefused = await pageDamage(editor.cookie, true)
    assertEquals(pageRefused.status, 403, await pageRefused.text())
    let posted = await client(k, 'damagelab.yaks.app', 'vale', editor.cookie)
      .post({
        entities: [{
          entity: { eid: hero },
          damageable: { on: true },
        }],
      })
    assert(posted.status >= 400, await posted.text())
    assertEquals(await state(), { on: false })

    await damage(true)
    assertEquals(await state(), { on: true })
  } finally {
    await k.stop()
  }
})
