// `/yak:continue`, the Claude Code plugin's command (plugins/yak), answered at
// the prompt hook (./routes.ts) before Claude Code asks its model anything:
// the hand-off is wanted most when that model's plan is spent. The hook
// blocks the prompt, and Claude Code shows the person the reason it gives,
// which is the answer.
//
// - `/yak:continue [provider/]model [words]` hands this conversation to that
//   model in place (@yaks/harness `session_send`), which takes it over here
//   and goes on from the words, or from "Continue.".
// - `/yak:continue S-12` writes another session into this Claude Code
//   account (`session_open`, ./resume.ts), for `/resume` to continue here.
// - `/yak:continue` alone says how, and how much room each plan has left.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Authenticate } from '@yaks/api'
import type { Runner } from '@yaks/tools'
import type { Host } from '@yaks/host'
import { answerOf, faultOf, toolEid } from '@yaks/tools/result'
import { accountOf, statusLine } from './statusline.ts'

/** The command, as the person types it. */
export let COMMAND = '/yak:continue'

/** What `/yak:continue` asks. */
export type Asked =
  | { open: string }
  | { provider?: string; model: string; text: string }
  | { how: true }

/**
 * What a prompt asks of `/yak:continue`, or nothing for any other prompt.
 *
 * ```ts
 * import { continued } from './continue.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(continued('/yak:continue codex/gpt-5.5 fix the test'),
 *   { provider: 'codex', model: 'gpt-5.5', text: 'fix the test' })
 * equal(continued('/yak:continue gpt-5.5'), { model: 'gpt-5.5', text: 'Continue.' })
 * equal(continued('/yak:continue S-12'), { open: 'S-12' })
 * equal(continued('/yak:continue'), { how: true })
 * equal(continued('/yak:continued'), undefined)
 * ```
 */
export let continued = (prompt: string): Asked | undefined => {
  let said = prompt.trim()
  if (said != COMMAND && !said.startsWith(COMMAND + ' ')) return undefined
  let [first, ...rest] = said.slice(COMMAND.length).trim().split(/\s+/)
  if (!first) return { how: true }
  if (/^[A-Z]+-\d+$|^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(first)) {
    return { open: first }
  }
  let slash = first.indexOf('/')
  return {
    ...slash > 0 ? { provider: first.slice(0, slash) } : {},
    model: slash > 0 ? first.slice(slash + 1) : first,
    text: rest.join(' ') || 'Continue.',
  }
}

let HOW = `${COMMAND} [provider/]model [words] hands this conversation to ` +
  `that model in yak; ${COMMAND} S-<n> brings a session here.`

type Door = {
  graph: Graph
  runner?: Runner
  who?: Authenticate
  text?: Host['text']
}

// Run a tool as the hook's caller would, and say what it answered.
let run = async (
  host: Door,
  request: Request,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ said: string; failed: boolean }> => {
  if (!host.runner || !host.text) {
    throw new Error(`${COMMAND} needs a tool runner and a text renderer`)
  }
  await host.runner.ensure([tool])
  let id = crypto.randomUUID()
  let actor = await host.who?.(request)
  let landed = await host.runner.call({
    entity: { eid: id },
    call: { to: toolEid(tool), args },
    ...actor ? { $actor: actor } : {},
  })
  let fault = faultOf(landed, id)
  if (fault) {
    let body = (fault.content ?? fault.doc) as Comp | undefined
    return { said: String(body?.body ?? `${tool} failed`), failed: true }
  }
  return {
    said: await host.text(answerOf(landed, id), { readOnly: false }),
    failed: false,
  }
}

let human = (b: Bundle | undefined) =>
  b?.entity.prefix && b.entity.num
    ? `${b.entity.prefix}-${b.entity.num}`
    : b?.entity.eid

/** The answer to `/yak:continue` from the Claude Code session that sent
 * `event`: what was done, or why not. */
export let carryOn = async (
  host: Door,
  request: Request,
  event: Record<string, unknown>,
  asked: Asked,
): Promise<string> => {
  let session = String(event.session_id ?? '')
  if ('how' in asked) {
    let room = await statusLine(host.graph, {
      transcript_path: String(event.transcript_path ?? ''),
    })
    return [HOW, room].filter(Boolean).join('\n')
  }
  if ('open' in asked) {
    let { said } = await run(host, request, 'session_open', {
      session: asked.open,
      in: 'claude',
      ...accountOf(String(event.transcript_path ?? ''))
        ? { account: accountOf(String(event.transcript_path)) }
        : {},
      ...typeof event.cwd == 'string' ? { cwd: event.cwd } : {},
    })
    return said
  }
  let { said, failed } = await run(host, request, 'session_send', {
    session,
    text: asked.text,
    model: asked.model,
    ...asked.provider ? { provider: asked.provider } : {},
    wait: false,
  })
  if (failed) return said
  let [row] = await host.graph.get([session])
  let id = human(row)
  return `${id} goes on with ${asked.model} in yak. Follow it in ` +
    `\`yak session tui\`; to bring it back here, \`${COMMAND} ${id}\`.`
}
