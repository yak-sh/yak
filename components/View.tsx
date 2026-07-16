import { type JSX } from 'preact'
import { bundle, db, type Ent } from '../db.ts'
import { Task } from './views/Task.tsx'
import { Board } from './views/Board.tsx'
import { Id } from './views/Id.tsx'
import { Dependency } from './views/Dependency.tsx'
import { Json } from './views/Json.tsx'

// The renderer registry — fixed and curated, extended only by editing this
// file (never at runtime), and only ever reached through <View>. A requested
// view name is not a lookup key: it is an input to matching, like the entity
// itself. A view can answer to its name (Id, Dependency), to bare
// applicability when nothing is asked (Task, Board), or to anything (JSON,
// the catch-all — keep it last). First match wins.
type Entry = {
  id: string
  match: (e: Ent, view?: string) => boolean
  View: (p: { e: Ent; [x: string]: unknown }) => JSX.Element
}

let registry: Entry[] = [
  { id: 'Task', match: (e, v) => !!e.task && (!v || v == 'Task'), View: Task },
  {
    id: 'Board',
    match: (e, v) => !!e.project && (!v || v == 'Board'),
    View: Board,
  },
  { id: 'Id', match: (_, v) => v == 'Id', View: Id },
  { id: 'Dependency', match: (_, v) => v == 'Dependency', View: Dependency },
  { id: 'JSON', match: () => true, View: Json },
]

// The tab row for an entity: every view that matches it unprompted.
export let applicable = (e: Ent) => registry.filter((v) => v.match(e))

// The one front door: render an entity through the first matching lens.
// Extra props flow through to the view.
export let View = (
  { eid, view, ...rest }: { eid: string; view?: string; [x: string]: unknown },
) => {
  let e = bundle(db, eid)
  let v = registry.find((r) => r.match(e, view))!
  return <v.View e={e} {...rest} />
}
