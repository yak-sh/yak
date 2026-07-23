import { type JSX } from 'preact'
import { findEid } from '../live.ts'
import { TimeVal, UrlVal } from './editors.tsx'
import { View } from './View.tsx'

// <Val value/> — the untyped door, beside <Prop> (a typed value through
// comps) and <View> (an entity through a view). For values with no comps
// path to say what they are: a matcher may check a CONSTRUCTOR (Date,
// URL) or a distinctive SHAPE (the id grammar, resolved against the live
// cache) — never date-parse or url-parse arbitrary prose. The list is
// curated match→first-hit like the editor registry; anything unclaimed
// falls back to its String face.

let ID = /^[A-Z]+-\d+$/

type Face = {
  match: (v: unknown) => boolean
  show: (v: unknown) => JSX.Element | null
}

export let faces: Face[] = [
  {
    match: (v) => v instanceof Date,
    show: (v) => TimeVal(v instanceof Date ? v.toISOString() : v),
  },
  { match: (v) => v instanceof URL, show: (v) => UrlVal(String(v)) },
  {
    match: (v) => typeof v == 'string' && ID.test(v) && !!findEid(v),
    show: (v) => <View eid={findEid(String(v))!} view='Id' />,
  },
]

export let faceFor = (v: unknown) => faces.find((f) => f.match(v))

export let Val = ({ value }: { value: unknown }) =>
  faceFor(value)?.show(value) ?? <>{String(value ?? '')}</>
