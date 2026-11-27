// Cloudflare isolates each script. The host lends only the scoped tool
// bridge, egress, and to a script that launches one, Cloudflare's browser.
import { type Evaluate, HOSTED_LIMITS } from '@yaks/code-mode'
import type { Caller } from '@yaks/egress'
import { CallError } from '@yaks/tools/errors'
import { caught } from './defects.ts'
import type { ScriptBill, ScriptTrace } from './script-spend.ts'

export type Outbound = { fetch(req: Request): Promise<Response> }
export type CodeEvaluate = (
  ...args: [
    ...Parameters<Evaluate>,
    options?: { caller?: Caller; bill?: ScriptBill; isolated?: boolean },
  ]
) => ReturnType<Evaluate>
export type Tail = { tail(events: ScriptTrace[]): Promise<void> }
type Permit = (bill: ScriptBill) => Promise<{
  tail: Tail
  release: () => Promise<boolean>
}>

export type Loader = {
  load(code: {
    compatibilityDate: string
    compatibilityFlags: string[]
    mainModule: string
    modules: Record<string, string>
    env: { BROWSER?: Outbound }
    globalOutbound: Outbound | null
    limits: { cpuMs: number; subRequests: number }
    tails?: Tail[]
  }): {
    getEntrypoint(): {
      run(bridge: unknown): PromiseLike<string> & Disposable
    }
  }
}

type Bridge = Parameters<Evaluate>[1]

/** The browser a script launches on, and how its time is held and charged. */
export type Browsing = {
  session: Outbound
  hold<T>(bill: ScriptBill, work: () => Promise<T>): Promise<T>
}

export let evaluator = (
  loader: Loader,
  target: (bridge: Bridge) => Bridge,
  outbound?: (caller?: Caller) => Outbound,
  permit?: Permit,
  browsing?: Browsing,
): CodeEvaluate =>
async (modules, bridge, signal, { caller, bill, isolated } = {}) => {
  let held: Awaited<ReturnType<Permit>> | undefined
  let sent = false
  try {
    signal.throwIfAborted()
    held = bill && permit ? await permit(bill) : undefined
    signal.throwIfAborted()
    let browses = 'puppeteer.js' in modules
    if (browses && !browsing) {
      throw new CallError('unavailable', 'no browser is bound here')
    }
    let worker = loader.load({
      compatibilityDate: '2026-11-01',
      compatibilityFlags: ['nodejs_compat'],
      mainModule: 'script.js',
      modules,
      env: browses ? { BROWSER: browsing!.session } : {},
      globalOutbound: isolated ? null : outbound?.(caller) ?? null,
      limits: { cpuMs: HOSTED_LIMITS.cpuMs, subRequests: 128 },
      ...held ? { tails: [held.tail] } : {},
    })
    let entry = worker.getEntrypoint()
    let run = async () => {
      // Loader and entrypoint handles aren't disposable; the RPC call is.
      using call = entry.run(target(bridge))
      sent = true
      let abort = () => call[Symbol.dispose]()
      signal.addEventListener('abort', abort, { once: true })
      try {
        return await call
      } finally {
        signal.removeEventListener('abort', abort)
      }
    }
    return browses && bill ? await browsing!.hold(bill, run) : await run()
  } catch (error) {
    if (signal.aborted) throw new CallError('expired', 'execution has ended')
    if (error instanceof CallError) throw error
    let message = error instanceof Error ? error.message : String(error)
    if (
      /CPU time|memory limit|exceeded.*limit|subrequest|syntaxerror|syntax error|no such module/i
        .test(message)
    ) throw new CallError('script', message.slice(0, 1024))
    caught(error, { where: 'code mode evaluator' })
    throw error
  } finally {
    if (held && !sent) {
      await held.release().catch((error) =>
        caught(error, { where: 'release script reservation' })
      )
    }
  }
}
