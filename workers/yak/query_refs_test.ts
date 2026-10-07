// Reference filters and their aggregates through the connector and app doors.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { connector, kernel, seed, txt, vocabFile } from './probe.ts'

test('typed and untyped eid filters return the same rows and counts at each door', async () => {
  let k = await kernel()
  try {
    let app = 'ref-queries'
    let space = `refs${crypto.randomUUID().slice(0, 8)}`
    let who = await seed(k, [{ slug: space, apps: [app, 'other'] }])
    let agent = connector(k, who.cookie)
    let at = { space, app }
    await agent.tool('app_files', {
      ...at,
      files: [{
        path: 'vocab.json',
        content: vocabFile({
          target: {},
          link: {
            typed: { ...txt, ref: 'target', death: 'keep' },
            any: { ...txt, ref: true, death: 'keep' },
          },
        }),
      }],
    })
    await agent.tool('app_deploy', at)
    await agent.tool('app_files', {
      space,
      app: 'other',
      files: [{ path: 'vocab.json', content: vocabFile({ spare: {} }) }],
    })
    await agent.tool('app_deploy', { space, app: 'other' })
    let target = crypto.randomUUID()
    let other = crypto.randomUUID()
    let match = crypto.randomUUID()
    await agent.tool('graph_apply', {
      ...at,
      entities: [
        { entity: { eid: target }, target: {} },
        { entity: { eid: other }, target: {} },
        {
          entity: { eid: match },
          link: { typed: target, any: target },
          doc: { title: 'salt & pepper' },
        },
        {
          entity: { eid: crypto.randomUUID() },
          link: { typed: other, any: other },
        },
      ],
    })
    let read = async (q: string) =>
      JSON.parse(await agent.tool('graph_query', { ...at, q }))
    let page = async (q: string) =>
      (await k.at(
        `${space}.yaks.app`,
        `/${app}/api/query?q=${encodeURIComponent(q)}`,
        {
          headers: { cookie: who.cookie },
        },
      )).json()
    for (let door of [read, page]) {
      for (let prop of ['typed', 'any']) {
        for (let sep of [' ', '&']) {
          let q = `.link.${prop}=${target}`
          for (let extra of ['', `${sep}.entity.eid=${match}`]) {
            let rows = await door(q + extra)
            assertEquals(
              rows.map((r: { entity: { eid: string } }) => r.entity.eid),
              [match],
            )
            assertEquals(await door(`${q}${extra}${sep}.count`), {
              count: rows.length,
            })
          }
        }
      }
    }
    let across = async (q: string) =>
      JSON.parse(await agent.tool('graph_query', { space, q }))
    for (let prop of ['typed', 'any']) {
      for (
        let q of [
          `(.link.${prop}=${target} .link.any=${target})`,
          `.link.${prop}=${target} .doc.title="salt & pepper"`,
          `.link.${prop}=${target}|.link.${prop}=${target}`,
        ]
      ) {
        let rows = await across(q)
        assertEquals(
          rows.map((r: { entity: { eid: string } }) => r.entity.eid),
          [match],
        )
        assertEquals(await across(`${q} .count`), { count: rows.length })
      }
    }
  } finally {
    await k.stop()
  }
})
