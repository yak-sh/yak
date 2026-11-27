// graph_query's refusals in an app space, said in the space's own words: a
// guessed word points at graph_schema before app_deploy, a property named alone
// is pointed at the app's components and never the platform's machinery, a
// word kept elsewhere says where.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { connector, kernel, seed, txt, unique, vocabFile } from './probe.ts'

test('graph_query refusals in a checks app speak its words', async () => {
  let k = await kernel()
  try {
    let space = unique('checks')
    let { cookie } = await seed(k, [{ slug: space, apps: ['checks'] }])
    let agent = connector(k, cookie)
    await agent.tool('app_files', {
      app: 'checks',
      path: 'vocab.json',
      op: 'write',
      content: vocabFile({ check: { note: txt } }),
    })
    await agent.tool('app_deploy', { app: 'checks' })
    let refused = (query: string, said: string) =>
      assertRejects(
        () => agent.tool('graph_query', { app: 'checks', query }),
        Error,
        said,
      )
    await refused(
      '.sandwich',
      'graph_schema lists every word this space declares, with its ' +
        'properties. Only for a new word',
    )
    await refused(
      '.note',
      '.note is a property, not a component — name it .check.note',
    )
    let conflict = await refused(
      '.draft_conflict',
      ".draft_conflict is a component in the space's Operator store",
    )
    assertStringIncludes(conflict.message, 'add self: true to graph_query')

    let page = (q: string) =>
      k.at(
        `${space}.yaks.app`,
        `/checks/api/query?q=${encodeURIComponent(q)}`,
        {
          headers: { cookie },
        },
      )
    for (
      let [q, hint] of [
        ['.entity.eid=', '.doc.title~="part of the title"'],
        ['.entity.eid=""', 'Copy entity.eid from a result'],
        ['.check&.refs=', 'is written !refs for absence'],
        ['.check&!refs', '!comment.target for absence'],
        ['.app&.trashed', `app_list(space: '${space}')`],
      ]
    ) {
      await refused(q, hint)
      let response = await page(q)
      assertEquals(response.status, 400, q)
      assertStringIncludes((await response.json()).error.message, hint)
    }
    let q = '.check&!comment.target&.count'
    assertEquals(await (await page(q)).json(), { count: 0 })
    assertEquals(
      JSON.parse(await agent.tool('graph_query', { app: 'checks', q })),
      { count: 0 },
    )
  } finally {
    await k.stop()
  }
})
