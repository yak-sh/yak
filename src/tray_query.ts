// The tray's standing session query, in a module the socket worker can import
// (live.ts is the browser's). The strip is mounted in every tab, so its one
// line is the first shell query every socket serves: a pooled worker warms it
// before its socket arrives (wsworker.ts), and the browser asks the identical
// string, so the warm statement is the served one.
import type { Field } from './query.ts'

// The session chrome, projected (D-22567 §3). `.session!` is the one UNBOUNDED
// kind — thousands of rows — and unprojected it put 6.22 MB on the wire for
// every tab, because a session entity's eager bag is its whole history: the
// final_text and usage_json and stderr of every run that ever finished, plus
// the created/updated/worktree/spawn provenance around them. The Tray's strip
// renders coloured DOTS.
//
// So the chrome asks for the columns it decides and paints with, and nothing
// else: enough to tell awake from settled and recent from old (Tray `shown`),
// sort by start, and give each dot its standing (session_status graphStanding —
// which reads `error`/`exception` for PRESENCE, hence their timestamps). A
// session's `provider`/`pid` are spawn-preferred through sessionOf, so both
// spellings ride or the merge reads a stale one.
export let dotFields: Field[] = [
  'session.status',
  'session.pid',
  'session.turn',
  'session.origin',
  'session.standing',
  'session.started_at',
  'session.finished_at',
  'session.provider',
  'spawn.provider',
  'runtime.pid',
  'run.started_at',
  'settled.status',
  'settled.at',
  'error.at',
  'exception.at',
].map((f) => {
  let [comp, prop] = f.split('.')
  return { comp, prop, wake: true }
})

// The strip shows active or recent sessions, not the first 1,000 historical
// sessions. One query says that union with `|` (query.ts OR), so a tab holds
// ONE sub and lands ONE frame for the strip where seven separate selections
// cost seven serves and seven render flushes (T-37445).
export let traySessionQuery = '.session!&(' + [
  '.session.status=starting,running,stopping',
  '.session.pid!&.session.finished_at=&.settled=',
  '.runtime.pid!&.session.finished_at=&.settled=',
  '.session.started_at>=6-hours-ago',
  '.run.started_at>=6-hours-ago',
  '.session.finished_at>=6-hours-ago',
  '.settled.at>=6-hours-ago',
].join('|') + ')&.fields=' +
  dotFields.map((f) => `${f.comp}.${f.prop}`).join(',')
