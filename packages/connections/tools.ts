// What anybody may ask about connections: the `@yaks/connections/tools` entry
// point, the implementations behind the two `tool: true` declarations in
// ./vocab.json. Neither touches a credential: `need` makes a connection with
// none, and `list` shows the handle where one is kept. Keys and grants arrive
// through trusted code (`connect`), never through a tool's arguments, which a
// graph keeps as the text of a call.

import { argsOf } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { list, need } from './connections.ts'

let str = (v: unknown): string => v == null ? '' : String(v)

let strs = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : []

/** The implementations of the tools ./vocab.json declares. */
export let runs = (): Runs => ({
  connection_need: (call, graph) => {
    let args = argsOf(call)
    return need(graph.read, {
      app: str(args.app),
      owner: str(args.owner),
      integration: str(args.integration),
      scopes: strs(args.scopes),
      hosts: strs(args.hosts),
      each: args.each == true,
      binding: args.binding == null ? undefined : str(args.binding),
      direct: args.direct == null ? undefined : args.direct == true,
    })
  },

  connection_list: (call, graph) => list(graph.read, str(argsOf(call).owner)),
})
