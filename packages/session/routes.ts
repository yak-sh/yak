// The hook door, exported as `@yaks/session/routes`: where a harness reports
// each tool call of a session it runs (Claude Code's HTTP hook, installed by
// ./hooks.ts), and hears back what the bus owes that session (./bus.ts
// `heard`). A harness runs many contexts under one session id, and only its
// hook says which context an event came from, so this is the one place the
// session's own line of work can be told from its subagents: before a call,
// the hook says which run makes it, and a door the call then reaches writes
// as that run (./announce.ts).
//
// A prompt is answered with its transcript's timing and, beside it, what the
// configured person said, kept and decided before on the same subject
// (@yaks/memory/earlier). The recall gets RECALL ms; a slower one is left out
// of this prompt's context rather than holding the turn.
//
// A body that is not a hook event is the caller's mistake, refused with a
// 400. Anything else that goes wrong is thrown to the host, which reports it;
// the harness treats a failed hook as nothing to add and carries on.

import { earlier } from '@yaks/memory/earlier'
import type { Host, Meaning } from '@yaks/host'
import type { Authenticate, Route } from '@yaks/api'
import { type Door, heard, type Hook } from './bus.ts'
import { hear } from './announce.ts'
import type { Runner } from '@yaks/tools'
import { lifecycle } from './lifecycle.ts'
import { promptContext } from './prompt.ts'

/** How long a prompt waits for earlier words before going without them. */
export let RECALL = 700

// The text a promise gives within `ms`, or none once they pass.
let within = (ms: number, text: Promise<string>): Promise<string> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    text,
    new Promise<string>((done) => timer = setTimeout(done, ms, '')),
  ]).finally(() => clearTimeout(timer))
}

/** Where the harness posts its hook events. */
export let PATH = '/session/hook'

// Whether the harness still waits for this answer. It gives up on a hook after
// its timeout (2 s, ./hooks.ts), and Deno tells a handler its client hung up
// only once the event loop turns, so the door lets it turn before asking.
let open = (request: Request): Promise<boolean> =>
  new Promise((done) => setTimeout(() => done(!request.signal.aborted)))

/** `POST /session/hook`: one hook event in, the context it adds out. */
export let routes = (
  host: Door & {
    config?: { person?: string }
    meaning?: Meaning
    who?: Authenticate
    runner?: Runner
    text?: Host['text']
    report?: Host['report']
  },
  { wait = RECALL }: { wait?: number } = {},
): Route[] => {
  // The person's eid, once the config names them.
  let person = async () => {
    let said = host.config?.person
    return said
      ? (await host.graph.address([said])).get(said) ?? said
      : undefined
  }
  let recall = async (words: string, before: string) =>
    earlier(host.graph, {
      person: await person(),
      words,
      before,
      meaning: host.meaning,
    })
  return [{
    method: 'POST',
    path: '/session/earlier',
    handle: async (request) => {
      // This door carries private historical words; apply the host's identity
      // boundary just as the graph read door does. Browser cross-origin posts
      // are not prompt hooks.
      if (request.headers.has('origin')) {
        return new Response('', { status: 403 })
      }
      await host.who?.(request)
      let input = await request.json().catch(() => null)
      if (typeof input?.words != 'string' || typeof input?.before != 'string') {
        return new Response('', { status: 400 })
      }
      return new Response(await recall(input.words, input.before))
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
      // A prompt's context is its transcript's timing, read as the CLI reads it
      // (./cli.ts), and what its person said before, within `wait`.
      let event = hook as Record<string, unknown>
      if (event.hook_event_name == 'UserPromptSubmit') {
        let words = typeof event.prompt == 'string' ? event.prompt : ''
        let recalled = await within(
          wait,
          recall(words, new Date().toISOString()).catch(async (e) => {
            if (!host.report) throw e
            await host.report(e)
            return ''
          }),
        )
        let text = [
          promptContext(event),
          recalled,
        ].filter(Boolean).join('\n\n')
        return Response.json(
          text
            ? {
              hookSpecificOutput: {
                hookEventName: 'UserPromptSubmit',
                additionalContext: text,
              },
            }
            : {},
        )
      }
      let edge = await lifecycle(host, request, event)
      if (edge) return edge
      if (await hear(host.graph, hook)) return Response.json({})
      return Response.json(
        await heard(host, hook as Hook, () => open(request)),
      )
    },
  }]
}
