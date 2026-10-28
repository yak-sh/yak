// The hook door, exported as `@yaks/session/routes`: where a harness reports
// each tool call of a session it runs (Claude Code's HTTP hook, installed by
// ./hooks.ts), and hears back what the bus owes that session (./bus.ts
// `heard`). A harness runs many contexts under one session id, and only its
// hook says which context an event came from, so this is the one place the
// session's own line of work can be told from its subagents: before a call,
// the hook says which run makes it, and a door the call then reaches writes
// as that run (./announce.ts).
//
// A body that is not a hook event is the caller's mistake, refused with a
// 400. Anything else that goes wrong is thrown to the host, which reports it;
// the harness treats a failed hook as nothing to add and carries on.

import { earlier } from '@yaks/memory/earlier'
import type { Host, Meaning } from '@yaks/host'
import type { Graph } from '@yaks/graph'
import type { Authenticate, Route } from '@yaks/api'
import { heard, type Hook } from './bus.ts'
import { hear } from './announce.ts'
import type { Runner } from '@yaks/tools'
import { lifecycle } from './lifecycle.ts'

/** Where the harness posts its hook events. */
export let PATH = '/session/hook'

/** `POST /session/hook`: one hook event in, the context it adds out. */
export let routes = (
  host: {
    graph: Graph
    config?: { person?: string }
    meaning?: Meaning
    who?: Authenticate
    runner?: Runner
    text?: Host['text']
  },
): Route[] => [{
  method: 'POST',
  path: '/session/earlier',
  handle: async (request) => {
    // This door carries private historical words; apply the host's identity
    // boundary just as the graph read door does. Browser cross-origin posts
    // are not prompt hooks.
    if (request.headers.has('origin')) return new Response('', { status: 403 })
    await host.who?.(request)
    let input = await request.json().catch(() => null)
    if (typeof input?.words != 'string' || typeof input?.before != 'string') {
      return new Response('', { status: 400 })
    }
    let said = host.config?.person
    let person = said
      ? (await host.graph.address([said])).get(said) ?? said
      : undefined
    return new Response(
      await earlier(host.graph, {
        person,
        words: input.words,
        before: input.before,
        meaning: host.meaning,
      }),
    )
  },
}, {
  method: 'POST',
  path: PATH,
  handle: async (request) => {
    let hook: unknown = await request.json().catch(() => null)
    if (!hook || typeof hook != 'object' || Array.isArray(hook)) {
      return Response.json(
        { error: 'a hook event is a JSON object' },
        { status: 400 },
      )
    }
    let edge = await lifecycle(host, request, hook as Record<string, unknown>)
    if (edge) return edge
    if (await hear(host.graph, hook)) return Response.json({})
    return Response.json(await heard(host.graph, hook as Hook))
  },
}]
