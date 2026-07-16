import { type JSX } from 'preact'
import { bundle, db, type Ent } from '../db.ts'
import { Task } from './views/Task.tsx'
import { Board } from './views/Board.tsx'
import { Dependency } from './views/Dependency.tsx'
import { Json } from './views/Json.tsx'

// The renderer registry — fixed and curated, extended only by editing this
// file (never at runtime), and only ever reached through <View>. An entry
// matches by the components it requires; an entity's matches, specific first,
// are its card's tabs. `match: () => false` registers a view that never
// appears as a tab and is reached only by explicit name (Dependency).
type Entry = {
  id: string
  match: (e: Ent) => boolean
  View: (p: { e: Ent; [x: string]: unknown }) => JSX.Element
}

let registry: Entry[] = [
  { id: 'Task', match: (e) => !!e.task, View: Task },
  { id: 'Board', match: (e) => !!e.project, View: Board },
  { id: 'Dependency', match: () => false, View: Dependency },
  { id: 'JSON', match: () => true, View: Json },
]

// The tab row for an entity: every view that matches it.
export let applicable = (e: Ent) => registry.filter((v) => v.match(e))

// The one front door: render an entity through a lens — the named one, or the
// best match. Extra props flow through to the view.
export let View = (
  { eid, view, ...rest }: { eid: number; view?: string; [x: string]: unknown },
) => {
  let e = bundle(db, eid)
  let v = (view && registry.find((r) => r.id == view)) || applicable(e)[0]
  return <v.View e={e} {...rest} />
}
