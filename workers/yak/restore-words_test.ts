// A restored app and a word another app took while it was in the trash
// (T-1172): the word stays the taker's for the space, and the restored app
// keeps its own for its pages and rows (directory.ts `ranked`).
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { connector, kernel, num, signIn, txt, vocabFile } from './probe.ts'

test('a word another app took while an app was in the trash stays its own after the restore', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let agent = connector(k, jeff.cookie)
    let made = async (
      slug: string,
      defs: Record<string, Record<string, unknown>>,
    ) => {
      await agent.tool('app_new', { slug, title: slug })
      await agent.tool('app_files', {
        app: slug,
        path: 'vocab.json',
        op: 'write',
        content: vocabFile(defs),
      })
      return await agent.tool('app_deploy', { app: slug })
    }
    let host = `${jeff.email.split('@')[0]}.yaks.app`
    let names = async (app: string) => {
      let r = await k.at(host, `/${app}/api/query?.dish`, {
        headers: { cookie: jeff.cookie },
      })
      assertEquals(r.status, 200)
      return (await r.json()).map((b: { dish: { name: string } }) =>
        b.dish.name
      ).sort()
    }
    let write = (app: string | undefined, dish: Record<string, unknown>) =>
      agent.tool('graph_apply', {
        ...(app ? { app } : {}),
        entities: [{ entity: { eid: '$d' }, dish }],
      })

    await made('menu', { dish: { name: txt } })
    await write('menu', { name: 'Soup' })
    await agent.tool('app_delete', { app: 'menu' })
    await made('potluck', { dish: { name: txt, serves: num } })
    await write('potluck', { name: 'Pie', serves: 8 })

    assertStringIncludes(
      await agent.tool('app_restore', { app: 'menu' }),
      "dish is also potluck's, declared there while menu was in the trash",
    )
    assertEquals(await names('menu'), ['Soup'])
    assertEquals(await names('potluck'), ['Pie'])

    // The space's dish is potluck's: a new one with its shape lands there,
    // and an app made now uses it from there.
    await write(undefined, { name: 'Bread', serves: 4 })
    assertEquals(await names('potluck'), ['Bread', 'Pie'])
    assertStringIncludes(
      await made('third', { dish: { name: txt } }),
      'uses: dish from potluck',
    )
    assertEquals(await names('third'), ['Bread', 'Pie'])

    // And each keeps its own across another release.
    await agent.tool('app_deploy', { app: 'menu' })
    await write('menu', { name: 'Salad' })
    assertEquals(await names('menu'), ['Salad', 'Soup'])
    assertEquals(await names('potluck'), ['Bread', 'Pie'])
  } finally {
    await k.stop()
  }
})
