// Two sibling stores in a scratch space: Vale owns its villagers and heroes;
// Village Tasks owns a seeded task and visitor completions scoped to a hero.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { completion, WELCOME } from '../vale/village-tasks.ts'
import { eidOf } from '../vale/villagers.ts'
import { client, connector, kernel, seed } from '../../workers/yak/probe.ts'
import { completionEid } from './state.js'

Deno.test('a task completed in a sibling app changes Pip for one Vale hero', async () => {
  let k = await kernel()
  try {
    let space = `village${crypto.randomUUID().slice(0, 8)}`
    let them = await seed(k, [{ slug: space, apps: ['vale', 'village-tasks'] }])
    let agent = connector(k, them.cookie)
    let at = (app: string) => ({ space, app })
    let files = [
      'index.html',
      'main.js',
      'state.js',
      'style.css',
      'seed.json',
      'vocab.json',
    ]
    let content = (path: string) =>
      Deno.readTextFileSync(new URL(`./${path}`, import.meta.url))
    await agent.tool('app_files', {
      ...at('vale'),
      files: [{
        path: 'vocab.json',
        content: Deno.readTextFileSync(
          new URL('../vale/vocab.json', import.meta.url),
        ),
      }],
    })
    await agent.tool('app_deploy', at('vale'))
    await agent.tool('app_files', {
      ...at('village-tasks'),
      files: files.map((path) => ({ path, content: content(path) })),
    })
    await agent.tool('app_deploy', at('village-tasks'))
    await agent.tool('app_set', { ...at('vale'), access: 'open' })
    await agent.tool('app_set', { ...at('village-tasks'), access: 'open' })

    let host = `${space}.yaks.app`
    let vale = client(k, host, 'vale')
    let list = client(k, host, 'village-tasks')
    let hero = crypto.randomUUID(), other = crypto.randomUUID()
    await vale.applied({
      entities: [
        { entity: { eid: hero }, player: {} },
        { entity: { eid: other }, player: {} },
      ],
    })
    await client(k, host, 'vale', them.cookie).applied({
      entities: [{
        entity: { eid: eidOf('pip') },
        doc: { title: 'Pip' },
        villager: { id: 'pip', level: 'mossvale', home: 'plaza' },
      }],
    })

    let [task] = await list.get('.village_task')
    let [pip] = await vale.get('.villager&?doc')
    assertEquals(task.entity.eid, WELCOME)
    assertEquals(
      (task.village_task as { villager: string }).villager,
      pip.entity.eid,
    )
    assertEquals((pip.doc as { title: string }).title, 'Pip')
    let done = async (player: string) =>
      completion((filter) => list.get(filter), player)
    assertEquals(await done(hero), false)
    let tick = {
      entities: [{
        entity: { eid: await completionEid(WELCOME, hero) },
        village_done: { task: WELCOME, player: hero, at: Date.now() },
      }],
    }
    await list.applied(tick)
    assertEquals(await done(hero), true)
    assertEquals(await done(other), false)
    await (await list.post(tick)).body?.cancel()
    assertEquals((await list.get('.village_done')).length, 1)

    let page = await k.at(host, '/village-tasks/')
    assertEquals(page.status, 200)
    assertStringIncludes(await page.text(), 'Village Tasks')
    assert((await k.at(host, '/village-tasks/main.js')).ok)
  } finally {
    await k.stop()
  }
})
