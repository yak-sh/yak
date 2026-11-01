// Cloudflare is the isolation boundary. No parent bindings enter the child;
// the only capability is one revocable RpcTarget passed for one invocation.
import { RpcTarget } from 'cloudflare:workers'
import type { Evaluate, Result } from '@yaks/code-mode'
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
      run(bridge: unknown): Promise<string>
      [Symbol.dispose](): void
    }
    [Symbol.dispose](): void
  }
}

export let evaluator =
  (loader: Loader): Evaluate => async (modules, bridge, signal) => {
    class Bridge extends RpcTarget {
      call(set: string, name: string, args: string): Promise<Result> {
        return bridge.call(set, name, args)
      }
    }
    try {
      using worker = loader.load({
        compatibilityDate: '2026-11-01',
        mainModule: 'script.js',
        modules,
        env: {},
        globalOutbound: null,
        limits: { cpuMs: 100, subRequests: 32 },
      })
      using entry = worker.getEntrypoint()
      let abort = () => {
        entry[Symbol.dispose]()
        worker[Symbol.dispose]()
      }
      signal.addEventListener('abort', abort, { once: true })
      try {
        return await entry.run(new Bridge())
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
