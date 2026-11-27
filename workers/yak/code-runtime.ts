// Cloudflare isolates each script. The host lends only the scoped tool
// bridge, egress, and to a script that launches one, Cloudflare's browser.
// A REPL's cell runs the same Worker as its REPL's facet (repl-object.ts).
import { type Evaluate, HOSTED_LIMITS } from '@yaks/code-mode'
import type { Caller } from '@yaks/egress'
import { CallError } from '@yaks/tools/errors'
import { caught } from './defects.ts'
import type { ScriptBill, ScriptTrace } from './script-spend.ts'

export type Outbound = { fetch(req: Request): Promise<Response> }
/** How a script is run: for whom, billed to whom, and in which REPL. */
export type Running = {
  caller?: Caller
  bill?: ScriptBill
  isolated?: boolean
  repl?: string
}
export type CodeEvaluate = (
  ...args: [...Parameters<Evaluate>, options?: Running]
) => ReturnType<Evaluate>
export type Tail = { tail(events: ScriptTrace[]): Promise<void> }

/** The Worker a script runs as. */
export type Code = {
  compatibilityDate: string
  compatibilityFlags: string[]
  mainModule: string
  modules: Record<string, string>
  env: { BROWSER?: Outbound }
  globalOutbound: Outbound | null
  limits: { cpuMs: number; subRequests: number }
  tails?: Tail[]
}

export type Loader = {
  load(code: Code): {
    getEntrypoint(): {
      run(bridge: unknown): PromiseLike<string> & Disposable
    }
    getDurableObjectClass(name: string): unknown
  }
}

/** What a script's Worker is lent: egress for its caller, the tail that
 * settles its bill, and the browser it may launch. */
export type Lend = {
  outbound?: (caller?: Caller) => Outbound
  tail?: (call: string) => Tail
  browser?: Outbound
}

/** A script's Worker, as `lend` lends it for this run. */
export let workerCode = (
  modules: Record<string, string>,
  lend: Lend,
  { caller, bill, isolated }: Running = {},
): Code => ({
  compatibilityDate: '2026-11-01',
  compatibilityFlags: ['nodejs_compat'],
  mainModule: 'script.js',
  modules,
  env: 'puppeteer.js' in modules && lend.browser
    ? { BROWSER: lend.browser }
    : {},
  globalOutbound: isolated ? null : lend.outbound?.(caller) ?? null,
  limits: { cpuMs: HOSTED_LIMITS.cpuMs, subRequests: 128 },
  ...bill && lend.tail ? { tails: [lend.tail(bill.call)] } : {},
})

/** A REPL's object, which runs each of its cells. */
export type Repls = (repl: string) => {
  run(
    modules: Record<string, string>,
    bridge: unknown,
    running: Omit<Running, 'repl'>,
  ): PromiseLike<string> & Disposable
}

type Bridge = Parameters<Evaluate>[1]

export type Hosting = {
  lend?: Lend
  /** hold a billed run's most CPU on its space's budget, returning the
   * release for a run never sent */
  permit?: (bill: ScriptBill) => Promise<() => Promise<boolean>>
  /** hold and charge a billed run's browser time, when it may launch one */
  browse?: <T>(bill: ScriptBill, work: () => Promise<T>) => Promise<T>
  repls?: Repls
}

export let evaluator = (
  loader: Loader,
  target: (bridge: Bridge) => Bridge,
  { lend = {}, permit, browse, repls }: Hosting = {},
): CodeEvaluate =>
async (modules, bridge, signal, running = {}) => {
  let { bill, repl } = running
  let release: (() => Promise<boolean>) | undefined
  let sent = false
  try {
    signal.throwIfAborted()
    let browses = 'puppeteer.js' in modules
    if (browses && !lend.browser) {
      throw new CallError('unavailable', 'no browser is bound here')
    }
    if (repl && !repls) {
      throw new CallError('unavailable', 'no REPL is bound here')
    }
    release = bill && permit ? await permit(bill) : undefined
    signal.throwIfAborted()
    let started = () => {
      let { repl: _, ...rest } = running
      return repl
        ? repls!(repl).run(modules, target(bridge), rest)
        : loader.load(workerCode(modules, lend, running)).getEntrypoint()
          .run(target(bridge))
    }
    let run = async () => {
      // Loader and entrypoint handles aren't disposable; the RPC call is.
      using call = started()
      sent = true
      let abort = () => call[Symbol.dispose]()
      signal.addEventListener('abort', abort, { once: true })
      try {
        return await call
      } finally {
        signal.removeEventListener('abort', abort)
      }
    }
    return browses && bill && browse ? await browse(bill, run) : await run()
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
    if (release && !sent) {
      await release().catch((error) =>
        caught(error, { where: 'release script reservation' })
      )
    }
  }
}
