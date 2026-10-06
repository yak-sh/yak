// The tray's standing session queries, in a module the socket worker can
// import (live.ts is the browser's). The strip is mounted in every tab.
import type { Field } from './query.ts'

// The session chrome, projected (D-22567 §3). `.session` is unbounded
// kind — thousands of rows — and unprojected it put 6.22 MB on the wire for
// every tab, because a session entity's eager bag is its whole history: the
// final_text and usage_json and stderr of every run that ever finished, plus
// the created/updated/worktree/spawn provenance around them. The Tray's strip
// renders coloured dots.
//
// So the chrome asks for the columns it decides and paints with, and nothing
// else: the session's status and standing (@yaks/session), who it acts for,
// its process, and when it was made.
export let dotFields: Field[] = [
  'session.status',
  'session.standing',
  'session.actor',
  'process.pid',
  'exit.code',
  'created.at',
].map((f) => {
  let [comp, prop] = f.split('.')
  return { comp, prop, wake: true }
})

// The strip includes status candidates of any age and the newest personal
// sessions. `operator` is creation provenance; children and sourced work stay
// inside their session or in All sessions, even if a person later replies.
export let sessionCap = 8
export let personalSessions =
  '.session.operator=true&!spawned.parent&!session.source'

// Status selects candidates only: the tray determines live from runner leases
// or an unexited process, never from this transcript status. Keep the
// two selections separate: an OR materializes both arms before the
// outer query, then evaluates status again for their combined projection.
let fields = '&.fields=' +
  dotFields.map((f) => `${f.comp}.${f.prop}`).join(',')
let window = `&.order=-created.at&.limit=${sessionCap}`
export let trayActiveQuery = personalSessions +
  '&.session.status=pending,running' + fields + window
// A process-backed runner may remain live even when transcript status is settled.
export let trayProcessQuery = personalSessions +
  '&.process.pid&!exit' + fields + window
export let trayRecentQuery = personalSessions + fields + window

export let sessionFields = [
  ...dotFields.map((f) => `${f.comp}.${f.prop}`),
  'using.model',
  'using.effort',
  'doc.title',
  'brief.text',
]

// The Sessions destination (navigation.ts): a view of the store, not a saved
// board or a new entity.
export let allSessionsPath = '/?sessions'
export let allSessionsQuery = '.session&.order=-created.at&.fields=' +
  sessionFields.join(',')

/** Session chrome over this host's declared transcript and runtime columns. */
export let sessionQueries = (vocab: import('@yaks/vocab').Vocab) => {
  if (!vocab.comp('session')) {
    return { active: '', process: '', recent: '', detail: '', all: '' }
  }
  let offered = (fields: string[]) =>
    fields.filter((field) => {
      let [comp, prop] = field.split('.')
      return vocab.prop(comp, prop)
    })
  let fields = offered(dotFields.map((f) => `${f.comp}.${f.prop}`))
  let project = fields.length ? `&.fields=${fields.join(',')}` : ''
  let order = vocab.prop('created', 'at') ? '&.order=-created.at' : ''
  let personal = '.session' +
    (vocab.prop('session', 'operator') ? '&.session.operator=true' : '') +
    (vocab.prop('spawned', 'parent') ? '&!spawned.parent' : '') +
    (vocab.prop('session', 'source') ? '&!session.source' : '')
  let window = `${project}${order}&.limit=${sessionCap}`
  let detail = '.session&.fields=' + offered(sessionFields).join(',')
  return {
    active: vocab.prop('session', 'status')
      ? personal + '&.session.status=pending,running' + window
      : '',
    process: vocab.prop('process', 'pid') && vocab.comp('exit')
      ? personal + '&.process.pid&!exit' + window
      : '',
    recent: personal + window,
    detail,
    all: detail + order,
  }
}
