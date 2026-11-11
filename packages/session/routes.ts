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
// of this prompt's context rather than holding the turn. A prompt the harness
// wrote, a background task's notification, recalls nothing.
//
// A body that is not a hook event is the caller's mistake, refused with a
// 400. Anything else that goes wrong is thrown to the host, which reports it;
// the harness treats a failed hook as nothing to add and carries on.

import type { Host } from '@yaks/host'
import type { Authenticate, Route } from '@yaks/api'
import { type Door, heard, type Hook } from './bus.ts'
import { hear } from './announce.ts'
import type { Runner } from '@yaks/tools'
import { lifecycle } from './lifecycle.ts'
import { promptContext } from './prompt.ts'
import { RECALL, recall, type Recalling } from './recall.ts'

export { RECALL }

/** Where the harness posts its hook events. */
export let PATH = '/session/hook'

// Whether the harness still waits for this answer. It gives up on a hook after
// its timeout (2 s, ./hooks.ts), and Deno tells a handler its client hung up
// only once the event loop turns, so the door lets it turn before asking.
let open = (request: Request): Promise<boolean> =>
  new Promise((done) => setTimeout(() => done(!request.signal.aborted)))

// A prompt the harness wrote itself: Claude Code submits a finished
// background task's notification as a prompt. It is nobody's words, so
// nothing was said before on its subject.
let NOTICE = /^\s*<task-notification>/

/** `POST /session/hook`: one hook event in, the context it adds out. */
export let routes = (
  host: Door & Recalling & {
    who?: Authenticate
    runner?: Runner
    text?: Host['text']
  },
  { wait = RECALL }: { wait?: number } = {},
): Route[] => {
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
      return new Response(
        await recall(host, null).said(input.words, input.before),
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
      // A prompt's context is its transcript's timing, read as the CLI reads it
      // (./cli.ts), and what its person said before, within `wait`.
      let event = hook as Record<string, unknown>
      if (event.hook_event_name == 'UserPromptSubmit') {
        let words = typeof event.prompt == 'string' ? event.prompt : ''
        let recalled = NOTICE.test(words)
          ? ''
          : await recall(host, wait).said(words, new Date().toISOString())
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
