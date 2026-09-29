// An agent's app command reaches the same objective the Mossvale page reads;
// a gather credited by the page is then visible through the agent's command.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import words from '../../apps/vale/vocab.json' with { type: 'json' }
import { client, connector, kernel, seed } from './probe.ts'

test('a Mossvale command becomes a playable objective with queryable progress', async () => {
  let k = await kernel()
  try {
    let who = await seed(k, [{ slug: 'companionlab', apps: [] }])
    let agent = connector(k, who.cookie)
    let at = { space: 'companionlab', app: 'vale' }
    await agent.tool('app_new', { ...at, slug: 'vale', title: 'Mossvale' })
    await agent.tool('app_files', {
      ...at,
      files: [{ path: 'vocab.json', content: JSON.stringify(words) }],
    })
    await agent.tool('app_deploy', at)
    let page = client(k, 'companionlab.yaks.app', 'vale', who.cookie)
    let hero = crypto.randomUUID()
    await page.applied([{ entity: { eid: hero }, player: {} }])
    await agent.tool('command', {
      app: 'companionlab/vale',
      name: 'gather_wood',
      args: { player: hero, count: 1 },
    })
    let [request] = await page.get(`.directive.player=${hero}&?created`)
    assertEquals(request.directive, { player: hero, goal: 'wood', count: 1 })

    await page.applied([{
      entity: { eid: crypto.randomUUID() },
      item: { owner: hero, kind: 'oaklog', n: 1, at: Date.now() },
      gathered: {
        node: crypto.randomUUID(),
        life: 0,
        kind: 'oak',
        at: Date.now(),
        directive: request.entity.eid,
      },
    }])
    let progress = await agent.tool('command', {
      app: 'companionlab/vale',
      name: 'companion_progress',
      args: { directive: request.entity.eid },
    })
    assertStringIncludes(progress, 'oaklog')
    assertEquals(
      (await page.get(`.gathered.directive=${request.entity.eid}`)).length,
      1,
    )
  } finally {
    await k.stop()
  }
})
