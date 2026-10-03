// T-64687: preserve the CLI's pasted grant as a connection before retiring
// token.json. Land this script; locus runs it and restarts together.
import { compose, person } from '@yaks/cli/host'
import { read } from '../packages/cli/config.ts'
import { integrationEid, need, pick } from '@yaks/connections'
import { stateDir } from '../packages/cli/store.ts'
import type { Comp } from '@yaks/graph'
let config = Deno.args[0],
  state = Deno.args[1] ?? stateDir(),
  file = `${state}/token.json`
if (!config) throw new Error('explicit config required')
let tokens: Record<string, unknown>
try {
  tokens = JSON.parse(await Deno.readTextFile(file))
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e
  console.log(JSON.stringify({ found: 0, moved: 0, fileRemoved: false }))
  Deno.exit(0)
}
let host = await compose(read(config), ['graph'])
try {
  let owner = await person(host)
  if (!owner) throw new Error('configured person required')
  let before = (await host.graph.read('.connection')).length, moved = 0
  for (let [target, value] of Object.entries(tokens)) {
    if (typeof value != 'string' || !value) {
      throw new Error('invalid held token')
    }
    let name = new URL(/^https?:/.test(target) ? target : `https://${target}`)
        .hostname == 'yaks.app'
      ? 'yaks.app'
      : `${/^https?:/.test(target) ? target : `https://${target}`}/mcp`
    let existing = await pick(host.graph.read, owner, name)
    // A held token is never overwritten by a migrated one; make an independent pasted-key connection.
    if (name != 'yaks.app' || !existing) {
      await host.graph.apply([{
        entity: { eid: integrationEid(name) },
        integration: {
          name,
          hosts: [
            new URL(/^https?:/.test(target) ? target : `https://${target}`)
              .hostname,
          ],
        },
      }])
    }
    let [b] = await host.graph.apply(
      await need(host.graph.read, { owner, integration: name }),
    )
    let connection = (b.connection as Comp) ?? {},
      nameOf = String((b.secret as Comp).name)
    await host.graph.apply([{
      entity: { eid: b.entity.eid },
      connection: { ...connection, status: 'connected' },
      secret: { name: nameOf, value },
    }])
    moved++
  }
  let after = (await host.graph.read('.connection')).length
  if (after != before + moved) {
    throw new Error('connection count mismatch; token file retained')
  }
  await Deno.remove(file)
  console.log(
    JSON.stringify({
      found: Object.keys(tokens).length,
      moved,
      before,
      after,
      fileRemoved: true,
    }),
  )
} finally {
  await host.close()
}
