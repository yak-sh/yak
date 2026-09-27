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

// The strip includes active sessions of any age and recent sessions. Keep the
// two selections separate: an OR materializes both arms before the
// outer query, then evaluates status again for their combined projection.
let fields = '&.fields=' +
  dotFields.map((f) => `${f.comp}.${f.prop}`).join(',')
export let trayActiveQuery = '.session.status=pending,running' + fields
export let trayRecentQuery = '.session&.created.at>=6-hours-ago' + fields
