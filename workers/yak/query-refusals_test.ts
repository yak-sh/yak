// graph_query's refusals in an app space, said in the space's own words: a
// guessed word points at graph_schema before app_deploy, a property named alone
// is pointed at the app's components and never the platform's machinery, a
// word kept elsewhere says where.
import { test } from '@yaks/testing'
import { assertRejects, assertStringIncludes } from '@std/assert'
import { connector, kernel, signIn, txt, vocabFile } from './probe.ts'

test('graph_query refusals in a checks app speak its words', async () => {
  let k = await kernel()
  try {
    let agent = connector(k, (await signIn(k)).cookie)
    await agent.tool('app_new', { slug: 'checks', title: 'Checks' })
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
  } finally {
    await k.stop()
  }
})
