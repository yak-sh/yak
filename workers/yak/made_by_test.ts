// Who made an app and who deployed it last, through the whole kernel
// (probe.ts `kernel`): a person at their own browser is the actor, and an
// agent holding their credential is an actor of its own, for them (M-31958).
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { bearerFor, connector, kernel, meta, signIn, unique } from './probe.ts'
import { HELLO } from './mcp-probe.ts'
import { agentEid } from './instrument.ts'
import { day } from './html.ts'
import { managePath } from './route.ts'

type Stamp = { at?: string; by?: unknown; via?: unknown }
let idOf = (v: unknown) =>
  typeof v == 'string' ? v : (v as { eid?: string } | undefined)?.eid

test('a deploy is stamped with the person, or the agent writing for them, and when', async () => {
  let k = await kernel()
  try {
    let owner = await signIn(k)
    let own = connector(k, owner.cookie)
    let agent = connector(k, undefined, await bearerFor(k, owner.cookie))
    await agent.call('initialize', HELLO)
    let made = async (hand: typeof own) => {
      let slug = unique('made')
      await hand.tool('app_new', { slug, title: slug })
      await hand.tool('app_files', {
        app: slug,
        files: [{ path: 'index.html', content: '<h1>Hi</h1>' }],
      })
      await hand.tool('app_deploy', { app: slug })
      let [row] = await meta(k).query(
        `.app.slug=${slug}&?created&?deployed`,
      )
      return row as {
        entity: { eid: string }
        created?: Stamp
        deployed?: Stamp
      }
    }
    let mine = await made(own)
    assertEquals(idOf(mine.created?.by), owner.person)
    assertEquals(idOf(mine.deployed?.by), owner.person)
    assert(mine.deployed?.at && idOf(mine.deployed?.via))

    let theirs = await made(agent)
    let probe = agentEid(owner.person, HELLO.clientInfo.name)
    assertEquals(idOf(theirs.created?.by), probe)
    assertEquals(idOf(theirs.deployed?.by), probe)
    assert(theirs.deployed?.at && idOf(theirs.deployed?.via))
    let [row] = await meta(k).query(`.entity.eid=${probe}&?doc&?acts_for`) as {
      doc?: { title?: string }
      acts_for?: { person?: unknown }
    }[]
    assertEquals(row.doc?.title, 'probe')
    assertEquals(idOf(row.acts_for?.person), owner.person)

    // Both say so where people see their apps, and in /admin.
    let page = async (path: string, cookie: string) => {
      let r = await k.at(k.host, path, { headers: { cookie } })
      assertEquals(r.status, 200)
      return (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    }
    let today = day(new Date().toISOString(), 'short')
    let dashboard = await page(managePath('apps', owner.name), owner.cookie)
    assertStringIncludes(
      dashboard,
      `Made ${today} by ${owner.name} · Deployed ${today} by ${owner.name}`,
    )
    assertStringIncludes(
      dashboard,
      `Made ${today} by probe for ${owner.name} · Deployed ${today} by probe for ${owner.name}`,
    )
    let admin = await page(`/admin/${theirs.entity.eid}`, k.owner.cookie)
    assertStringIncludes(
      admin,
      `the last ${day(new Date().toISOString())} by probe for ${owner.name}`,
    )
    assertStringIncludes(
      admin,
      `Made ${day(new Date().toISOString())} by probe for ${owner.name}`,
    )
  } finally {
    await k.stop()
  }
})
