// The tray's standing session query, in a module the socket worker can import
// (live.ts is the browser's). The strip is mounted in every tab, so its one
// line is the first shell query every socket serves: a pooled worker warms it
// before its socket arrives, and the browser asks the identical
// string, so the warm statement is the served one.
import type { Field } from './query.ts'

// The session chrome, projected (D-22567 §3). `.session` is the one UNBOUNDED
// kind — thousands of rows — and unprojected it put 6.22 MB on the wire for
// every tab, because a session entity's eager bag is its whole history: the
// final_text and usage_json and stderr of every run that ever finished, plus
// the created/updated/worktree/spawn provenance around them. The Tray's strip
// renders coloured DOTS.
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

// The strip shows active or recent sessions, not the first 1,000 historical
// sessions. One query says that union with `|` (query.ts OR), so a tab holds
// ONE sub and lands ONE frame for the strip where seven separate selections
// cost seven serves and seven render flushes (T-37445).
export let traySessionQuery = '.session&(' + [
  '.session.status=pending,running',
  '.created.at>=6-hours-ago',
].join('|') + ')&.fields=' +
  dotFields.map((f) => `${f.comp}.${f.prop}`).join(',')
