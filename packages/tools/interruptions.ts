// Audited historical interruption records become marks on their request/call.
// Only explicit source references, or a bounded historical predecessor within
// the same transcript, associate a diagnostic. No provider code alone retries.

import { type Bundle, type Comp, token } from '@yaks/graph'

let comp = (b: Bundle, name: string): Comp => {
  let c = b[name]
  return c && typeof c == 'object' ? c : {}
}
let text = (b: Bundle, name: string, prop: string): string | undefined => {
  let v = comp(b, name)[prop]
  return typeof v == 'string' ? v : undefined
}
let id = (value: string) => {
  if (!/^[\w:-]+$/.test(value)) throw new Error('Unsafe interruption reference')
  return value
}
export type Reader = (query: string) => Bundle[]
let marks = (b: Bundle) => {
  let written = comp(b, 'created')
  return {
    at: written.at ?? null,
    by: written.by ?? null,
    via: written.via ?? null,
  }
}
let patch = (b: Bundle, values: Record<string, Comp | null>): Bundle => ({
  entity: b.entity,
  ...values,
  $was: Object.fromEntries(
    Object.keys(values).map(
      (name) => [
        name,
        Object.fromEntries(
          Object.keys(comp(b, name)).map((p) => [p, token(comp(b, name)[p])]),
        ),
      ],
    ),
  ),
})
let prior = (row: Bundle, read: Reader): Bundle | undefined => {
  let entry = comp(row, 'entry'), session = entry.session, seq = entry.seq
  if (typeof session != 'string' || typeof seq != 'number') {
    throw new Error(
      'Interruption diagnostic has no transcript position: ' + row.entity.eid,
    )
  }
  let [before] = read(
    `.entry.session=${id(session)}&.entry.seq<${seq}` +
      '&!notice&.order=-entry.seq&.limit=1&*',
  )
  if (before?.ask) return before
  let source = before && text(before, 'output', 'source')
  if (source) {
    let [ask] = read(`.entity.eid=${id(source)}&*`)
    if (ask?.ask && comp(ask, 'entry').session == session) return ask
  }
  return undefined
}
let failure = (row: Bundle, read: Reader): Bundle[] => {
  let code = text(row, 'error', 'code')!
  let source = text(row, 'output', 'source')
  let [from] = source ? read(`.entity.eid=${id(source)}&*`) : [prior(row, read)]
  if (!from && !source) {
    return [
      patch(row, {
        interrupted: { ...marks(row), code },
        ...code == 'interrupted'
          ? {
            failed: {
              ...marks(row),
              reason: 'Historical request interrupted; no request record',
            },
          }
          : {},
      }),
    ]
  }
  if (!from?.ask && !from?.call) {
    throw new Error(
      'Interruption source is not request/call: ' + row.entity.eid,
    )
  }
  let body = text(row, 'content', 'body') ?? ''
  let reason = code == 'interrupted' ? 'transport' : code
  if (body.startsWith('Tool call was superseded')) reason = 'superseded'
  if (
    body.startsWith('interrupted: process') ||
    body.includes('provider exited 143')
  ) reason = 'exit_143'
  let terminal = from.ask && code == 'interrupted'
  return [
    patch(from, {
      interrupted: { ...marks(row), code: reason },
      ...terminal
        ? {
          failed: {
            ...marks(row),
            reason: 'Historical interrupted request; inspect before retry',
          },
        }
        : {},
      ...from.ask && !terminal &&
          text(from, 'attempt', 'state') == 'interrupted'
        ? { provisional: { note: 'Historical provider retry still owed' } }
        : {},
    }),
    patch(row, { interrupted: { ...marks(row), code: reason } }),
    ...!source && from.ask
      ? [{ entity: row.entity, output: { source: from.entity.eid } }]
      : [],
  ]
}
export let interruptionFind = [
  '.error&!interrupted&*',
  '.attempt.state=interrupted&!interrupted&*',
  '.attempt.state=inflight&!attempt.by&*',
  '.execution.state=done&!results&*',
]
export let interruptionMove = (row: Bundle, read: Reader): Bundle[] => {
  let code = text(row, 'error', 'code')
  if (code == 'exit') {
    // Spawn readers already retain exit{code} on the session. The line is stop.
    return [patch(row, { interrupted: { ...marks(row), code: 'exit' } })]
  }
  if (code) return failure(row, read)
  if (text(row, 'attempt', 'state') == 'interrupted' && !row.interrupted) {
    return [patch(row, { interrupted: { ...marks(row), code: 'restart' } })]
  }
  if (text(row, 'attempt', 'state') == 'inflight' && !comp(row, 'attempt').by) {
    let holder = comp(row, 'entry').session
    if (typeof holder != 'string') {
      throw new Error('Inflight ask lacks session: ' + row.entity.eid)
    }
    return [patch(row, { attempt: { by: holder } })]
  }
  if (text(row, 'execution', 'state') == 'done') {
    return [{
      entity: { eid: '$result' },
      result: { call: row.entity.eid },
    }]
  }
  return []
}

// Contract is admitted only after expansion; no state supplies evidence here.
export let interruptionContractFind = [
  '.error&.interrupted&*',
  '.attempt.state&*',
  '.execution.state&*',
]
export let interruptionContract = (row: Bundle): Bundle[] => {
  if (row.error && row.interrupted) {
    let code = text(row, 'error', 'code')
    return [
      patch(row, {
        error: null,
        ...code == 'exit'
          ? { interrupted: null, stop: {} }
          : row.output
          ? { notice: {} }
          : {},
      }),
    ]
  }
  if (text(row, 'attempt', 'state') != undefined) {
    return [patch(row, { attempt: { state: null } })]
  }
  if (text(row, 'execution', 'state') != undefined) {
    return [patch(row, { execution: { state: null } })]
  }
  return []
}
