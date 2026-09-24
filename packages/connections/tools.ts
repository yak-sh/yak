// What anybody may ask about connections: the `@yaks/connections/tools` entry
// point, the implementations behind the two `tool: true` declarations in
// ./vocab.json. Neither touches a credential: `need` makes a connection with
// none, and `list` shows the handle where one is kept. Keys and grants arrive
// through trusted code (`connect`), never through a tool's arguments, which a
// graph keeps as the text of a call.

import { addressed } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { list, need } from './connections.ts'

let str = (v: unknown): string => v == null ? '' : String(v)

let strs = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : []

/** The implementations of the tools ./vocab.json declares. */
export let runs = (): Runs => ({
  connection_need: async (_bundles, ctx) => {
    let [app, owner] = await addressed(ctx.graph, [
      str(ctx.args.app),
      str(ctx.args.owner),
    ])
    return need(ctx.read, {
      app,
      owner,
      integration: str(ctx.args.integration),
      scopes: strs(ctx.args.scopes),
      hosts: strs(ctx.args.hosts),
    })
  },

  connection_list: async (_bundles, ctx) => {
    let [owner] = await addressed(ctx.graph, [str(ctx.args.owner)])
    return list(ctx.read, owner)
  },
})
