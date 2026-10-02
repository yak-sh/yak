import type { Access, Eid } from '@yaks/graph'
import { type Effects, HOLD, holding } from '@yaks/effects'
import type { Host } from './types.ts'

/** A leased duty that honors shutdown and finishes its cleanup. */
export type Service = (signal: AbortSignal) => unknown | Promise<unknown>
/** Code and lifecycle options for the roles a host serves. */
export type Roles = {
  me: Eid
  roles: readonly string[]
  fx?: Effects
  services?: Record<string, Service>
  hold?: number
  gone?: (holder: Eid) => boolean | Promise<boolean>
  report?: (error: unknown, role: string) => unknown
  close?: () => void | Promise<void>
}

/** Work the ordinary effects pool and leased services under the given roles.
 * The opening module supplies handlers and services; this owns their lifetime. */
export let roles = (graph: Access, opts: Roles): Host => {
  let mine = [...new Set(opts.roles)]
  let stopping = new AbortController()
  let report = opts.report ?? console.error
  let reportPool = (error: unknown) => report(error, 'effects')
  for (let role of mine) {
    if (role == 'effects' ? !opts.fx : !opts.services?.[role]) {
      throw new Error(`no code serves the thread role ${role}`)
    }
  }
  let closing: Promise<void> | undefined
  let running = new Set<Promise<void>>()
  let stop = () => {
    stopping.abort()
    void opts.fx?.stop().catch(reportPool)
  }
  return {
    duties: (signal, only) => {
      if (stopping.signal.aborted) return Promise.resolve()
      let until = AbortSignal.any([signal, stopping.signal])
      let doing = Promise.all(
        mine.filter((r) => !only || only.includes(r)).map((role) =>
          role == 'effects'
            ? opts.fx!.work(graph, until).catch(reportPool)
            : holding(graph, role, {
              holder: opts.me,
              hold: opts.hold ?? HOLD,
              gone: opts.gone,
              signal: until,
              report: (error) => report(error, role),
            }, opts.services![role]).catch((error) => report(error, role))
        ),
      ).then(() => {})
      running.add(doing)
      void doing.then(() => running.delete(doing), () => running.delete(doing))
      return doing
    },
    nudge: () => opts.fx?.wake(),
    stop,
    close: () =>
      closing ??= (async () => {
        stop()
        await Promise.all(running)
        await opts.fx?.stop()
        await opts.close?.()
      })(),
  }
}
