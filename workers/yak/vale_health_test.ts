// Mossvale's health command changes a hero through the same guarded store
// door as the page. Only the space owner may set invulnerability.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import words from '../../apps/vale/vocab.json' with { type: 'json' }
import { accepted, client, connector, kernel, seed, signIn } from './probe.ts'

Deno.test('the Mossvale owner turns a hero’s health mode on and off', async () => {
  let k = await kernel()
  try {
    let owner = await seed(k, [{ slug: 'healthlab', apps: [] }])
    let agent = connector(k, owner.cookie)
    let at = { space: 'healthlab', app: 'vale' }
    await agent.tool('app_new', { ...at, slug: 'vale', title: 'Mossvale' })
    await agent.tool('app_files', {
      ...at,
      files: [{ path: 'vocab.json', content: JSON.stringify(words) }],
    })
    await agent.tool('app_deploy', at)

    let page = client(k, 'healthlab.yaks.app', 'vale', owner.cookie)
    let hero = crypto.randomUUID()
    await page.applied({ entities: [{ entity: { eid: hero }, player: {} }] })
    let health = (on: boolean) =>
      agent.tool('command', {
        app: 'healthlab/vale',
        name: 'health_mode',
        args: { player: hero, on },
      })
    let state = async () =>
      (await page.get(`.eid=${hero}&?invulnerable`))[0]?.invulnerable

    await health(true)
    assertEquals(await state(), { on: true })

    let editor = await signIn(k)
    await agent.tool('member_add', {
      space: 'healthlab',
      email: editor.email,
      role: 'editor',
    })
    await accepted(k, editor.email, editor.cookie)
    let another = connector(k, editor.cookie)
    let refused = await assertRejects(() =>
      another.tool('command', {
        app: 'healthlab/vale',
        name: 'health_mode',
        args: { player: hero, on: false },
      })
    )
    assert(refused instanceof Error)
    assertStringIncludes(refused.message, 'owner is the least that may')
    let posted = await client(k, 'healthlab.yaks.app', 'vale', editor.cookie)
      .post({
        entities: [{
          entity: { eid: hero },
          invulnerable: { on: false },
        }],
      })
    assert(posted.status >= 400, await posted.text())
    assertEquals(await state(), { on: true })

    await health(false)
    assertEquals(await state(), { on: false })
  } finally {
    await k.stop()
  }
})
