// A custom integration made before integrations kept their owner (T-132635)
// is given one: the space holding its oldest connection, which is the space
// that first asked for it. One that no space holds a connection through keeps
// none, and is nobody's to change (@yaks/connections `set`). Only the
// directory holds integrations.
import type { Comp } from '@yaks/graph'
import { PLATFORM_STORE } from './door.ts'
import type { Rule } from './mover.ts'

export let integrationOwnerRule: Rule = {
  mark: 'yak/store/integration-owner/1',
  stores: [PLATFORM_STORE],
  live: 'all',
  find: '.integration&!integration.built&!integration.owner&*',
  move: (row, read) => {
    if (!read) {
      throw new Error("an integration's owner is read off its connections")
    }
    let name = (row.integration as Comp).name
    // A name is somebody's words, which a line would have to quote, so the
    // connections are compared here, after the read.
    let through = read('.connection&*&.order=created.at')
      .map((b) => b.connection as Comp)
      .filter((c) => c.integration == name)
    let owners = [...new Set(through.map((c) => String(c.owner)))]
    let spaces = owners.length
      ? new Set(
        read(`.entity.eid=${owners.join(',')}&.space`).map((b) => b.entity.eid),
      )
      : new Set()
    let owner = through.find((c) => spaces.has(String(c.owner)))?.owner
    return owner
      ? [{
        entity: { eid: row.entity.eid },
        integration: { owner },
        $was: { integration: { owner: null } },
      }]
      : []
  },
}
