import { type JSX } from 'preact'
import { type Ent } from '../db.ts'
import { TaskView } from './Task.tsx'
import { Board } from './Board.tsx'
import { Json } from './Json.tsx'

// The renderer registry — fixed and curated, extended only by editing this
// file (never at runtime). A view matches by the components it requires; an
// entity's matches, specific first, are its card's tabs.
export type View = {
  id: string
  match: (e: Ent) => boolean
  View: (p: { e: Ent }) => JSX.Element
}

export let views: View[] = [
  { id: 'Task', match: (e) => !!e.task, View: TaskView },
  { id: 'Board', match: (e) => !!e.project, View: Board },
  { id: 'JSON', match: () => true, View: Json },
]

export let applicable = (e: Ent) => views.filter((v) => v.match(e))

// Resolve a card's stored view id; the JSON floor catches anything unknown.
export let view = (id: string) => views.find((v) => v.id == id) ?? views.at(-1)!
