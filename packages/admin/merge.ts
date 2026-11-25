// Three-way merges of one app file: `ours` is the checkout's text, `live` the
// text the platform changed it to, and `base` the newest text both held.
// Where both changed the same part, the platform's wins and git keeps its own
// in history.

import { merge as byKey } from '@yaks/copy'
import { diffIndices } from 'node-diff3'

/** A merged text, and whether both sides changed the same part of it. */
export type Merged = { content: string; conflict: boolean }

let lines = (text: string) => text.split(/(?<=\n)/).filter(Boolean)

let edits = (base: string[], text: string) =>
  diffIndices(base, lines(text)).map(({
    buffer1: [start, length],
    buffer2Content,
  }) => ({ start, end: start + length, text: buffer2Content.join('') }))

type Edit = ReturnType<typeof edits>[number]

// Two insertions at the same point overlap. A change ending where another
// begins still fits beside it.
let overlaps = (a: Edit, b: Edit) =>
  a.start < b.end && b.start < a.end ||
  a.start == b.start && a.end == b.end

/// mergeLines('a\nB\n', 'A\nb\n', 'a\nb\n') -> { content: 'A\nB\n', conflict: false }
/// mergeLines('a\nours\n', 'a\nlive\n', 'a\nb\n') -> { content: 'a\nlive\n', conflict: true }
/** A text merged by line. */
export let mergeLines = (ours: string, live: string, base: string): Merged => {
  let before = lines(base)
  let incoming = edits(before, live)
  let conflict = false
  let kept = edits(before, ours).filter((edit) => {
    let other = incoming.find((other) => overlaps(edit, other))
    if (!other) return true
    conflict ||= edit.start != other.start || edit.end != other.end ||
      edit.text != other.text
    return false
  })
  let at = 0
  let merged = [...incoming, ...kept]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map(({ start, end, text }) => {
      let unchanged = before.slice(at, start).join('')
      at = end
      return unchanged + text
    })
  return { content: merged.join('') + before.slice(at).join(''), conflict }
}

type Json = unknown

let object = (v: Json): v is Record<string, Json> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

let own = (v: Record<string, Json> | undefined, key: string) =>
  v && Object.hasOwn(v, key) ? v[key] : undefined

let same = (a: Json, b: Json): boolean => {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length == b.length && a.every((v, i) => same(v, b[i]))
  }
  if (!object(a) || !object(b)) return false
  let keys = Object.keys(a)
  return keys.length == Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
}

// `undefined` is a key one side does not have.
let mergeValue = (ours: Json, live: Json, base: Json): {
  value: Json
  conflict: boolean
} => {
  if (same(live, base) || same(ours, live)) {
    return { value: ours, conflict: false }
  }
  if (same(ours, base)) return { value: live, conflict: false }
  if (!object(ours) || !object(live) || base != null && !object(base)) {
    return { value: live, conflict: true }
  }
  let conflict = false
  let keys = [...new Set([...Object.keys(ours), ...Object.keys(live)])]
  let entries = keys.flatMap((key) => {
    let m = mergeValue(
      own(ours, key),
      own(live, key),
      own(base as Record<string, Json> | undefined, key),
    )
    conflict ||= m.conflict
    return m.value === undefined ? [] : [[key, m.value] as const]
  })
  return { value: Object.fromEntries(entries), conflict }
}

let parse = (text: string): { value: Json } | undefined => {
  if (!text.trim()) return { value: undefined }
  try {
    return { value: JSON.parse(text) }
  } catch {
    return undefined
  }
}

/// mergeJson('{"a":1,"b":2}', '{"a":3,"b":1}', '{"a":1,"b":1}') -> { content: '{\n  "a": 3,\n  "b": 2\n}', conflict: false }
/// mergeJson('{"a":2}', '{"a":3}', '{"a":1}') -> { content: '{"a":3}', conflict: true }
/// mergeJson('{"a":', '{}', '{}') -> undefined
/** A JSON text merged key by key at every depth, so it keeps each key once.
 * Arrays and other values merge whole. Undefined when a text is not JSON. The
 * result is indented as `ours` is, or is `ours` or `live` as written when it
 * equals one. */
export let mergeJson = (
  ours: string,
  live: string,
  base: string,
): Merged | undefined => {
  let [o, l, b] = [ours, live, base].map(parse)
  if (!o || !l || !b) return
  let { value, conflict } = mergeValue(o.value, l.value, b.value)
  if (same(value, o.value)) return { content: ours, conflict }
  if (same(value, l.value)) return { content: live, conflict }
  let indent = /\n([ \t]+)"/.exec(ours)?.[1] ?? 2
  let content = JSON.stringify(value, null, indent) +
    (ours.endsWith('\n') ? '\n' : '')
  return { content, conflict }
}

/// merge('package-lock.json', '{"a":2}', '{"b":2}', '{}') -> { content: '{"b":2}', conflict: true }
/** The file at `path` merged as what it is: copy.json by key, where a key
 * edited on the page keeps the page's text (@yaks/copy); a lock both sides
 * changed is a conflict, since a lock is regenerated, never merged; any other
 * JSON file key by key; every other file by line. */
export let merge = (
  path: string,
  ours: string,
  live: string,
  base: string,
): Merged => {
  if (path == 'copy.json') {
    return { content: byKey(ours, live, base), conflict: false }
  }
  if (/(^|\/)package-lock\.json$/.test(path)) {
    return ours == base || ours == live
      ? { content: live, conflict: false }
      : live == base
      ? { content: ours, conflict: false }
      : { content: live, conflict: true }
  }
  return path.endsWith('.json') && mergeJson(ours, live, base) ||
    mergeLines(ours, live, base)
}
