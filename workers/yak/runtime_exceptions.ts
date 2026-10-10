// Shared runners report defects through their committed exception records.
// Platform breaks carrying only message keep their own reporting boundary.
import type { Effects, Event } from '@yaks/effects'
import type { ReadTx } from '@yaks/graph'
import { actionable } from '@yaks/tools'

export let runtimeExceptions = (
  fx: Pick<Effects, 'created'>,
  report: (error: Error, event: Event, tx: ReadTx) => unknown,
) =>
  fx.created('exception', (event, tx) => {
    let x = event.comp
    if (typeof x?.value != 'string' || !x.value.trim()) return
    if (!actionable(x.value)) return
    let error = new Error(x.value)
    error.name = typeof x.type == 'string' ? x.type : 'Error'
    error.stack = typeof x.stack == 'string' ? x.stack : undefined
    return report(error, event, tx)
  })
