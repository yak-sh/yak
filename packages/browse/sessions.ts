// The session queries browse draws, in a module the socket worker can import
// (live.ts is the browser's): the Sessions page's history list, a session
// row's columns, and the columns a session's dot decides with.
import type { Field } from './query.ts'

// A session's dot, projected (D-22567 §3). A session entity's eager bag is
// its whole history: the final_text and usage_json and stderr of every run
// that ever finished, plus the created/updated/worktree/spawn provenance
// around them. So a dot asks for the columns it decides and paints with, and
// nothing else: the session's status and standing (@yaks/session), who it
// acts for, its process, and when it was made.
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

// What a session row paints beside its dot.
export let sessionFields = [
  ...dotFields.map((f) => `${f.comp}.${f.prop}`),
  'using.model',
  'using.effort',
  'doc.title',
  'session.source',
  'session.operator',
  'session.transcript',
  'native',
]

// The Sessions destination (navigation.ts): a view of the store, not a saved
// board or a new entity. A history list, newest first.
export let allSessionsPath = '/?page=sessions'
export let allSessionsQuery = '.session&.order=-created.at&.fields=' +
  sessionFields.join(',')

/** Session rows over this host's declared transcript and runtime columns:
 * `detail` is a row's columns, `all` the Sessions page's history list. */
export let sessionQueries = (vocab: import('@yaks/vocab').Vocab) => {
  if (!vocab.comp('session')) return { detail: '', all: '' }
  let offered = sessionFields.filter((field) => {
    let [comp, prop] = field.split('.')
    return prop ? vocab.prop(comp, prop) : vocab.comp(comp)
  })
  let order = vocab.prop('created', 'at') ? '&.order=-created.at' : ''
  let detail = '.session&.fields=' + offered.join(',')
  return { detail, all: detail + order }
}
