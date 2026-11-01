// Cloudflare is the isolation boundary. No parent bindings enter the child;
// the only capability is one revocable RpcTarget passed for one invocation.
import type { Evaluate } from '@yaks/code-mode'
import { CallError } from '@yaks/tools/errors'
import { caught } from './defects.ts'

export type Loader = {
  load(code: {
    compatibilityDate: string
    mainModule: string
    modules: Record<string, string>
    env: Record<string, never>
    globalOutbound: null
    limits: { cpuMs: number; subRequests: number }
  }): {
    getEntrypoint(): {
      run(bridge: unknown): PromiseLike<string> & Disposable
    }
  }
}

type Bridge = Parameters<Evaluate>[1]

export let evaluator =
  (loader: Loader, target: (bridge: Bridge) => Bridge): Evaluate =>
  async (modules, bridge, signal) => {
    try {
      signal.throwIfAborted()
      let worker = loader.load({
        compatibilityDate: '2026-11-01',
        mainModule: 'script.js',
        modules,
        env: {},
        globalOutbound: null,
        limits: { cpuMs: 100, subRequests: 32 },
      })
      let entry = worker.getEntrypoint()
      // Loader and entrypoint handles aren't disposable; the RPC call is.
      using call = entry.run(target(bridge))
      let abort = () => call[Symbol.dispose]()
      signal.addEventListener('abort', abort, { once: true })
      try {
        return await call
      } finally {
        signal.removeEventListener('abort', abort)
      }
    } catch (error) {
      if (signal.aborted) throw new CallError('expired', 'execution has ended')
      let message = error instanceof Error ? error.message : String(error)
      if (
        /CPU time|memory limit|exceeded.*limit|subrequest|syntaxerror|syntax error|no such module/i
          .test(message)
      ) throw new CallError('script', message.slice(0, 1024))
      caught(error, { where: 'code mode evaluator' })
      throw error
    }
  }
