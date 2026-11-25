import { CallError } from '@yaks/tools/errors'
import { noFile } from './versions.ts'

export type Edit = { path: string; find: string; replace: string }

let WIDTH = 160
let CONTEXT = 64 * 1024

let excerpt = (text: string, at: number, start: number, end: number) => {
  let from = Math.max(start, Math.min(at - Math.floor(WIDTH / 3), end - WIDTH))
  let to = Math.min(end, from + WIDTH)
  return (from > start ? '…' : '') + text.slice(from, to).replace(/\r$/, '') +
    (to < end ? '…' : '')
}

let locations = (text: string, find: string, parts: string[]) => {
  let hits = parts.length - 1
  let at = 0
  let line = 1
  let start = 0
  let end = text.indexOf('\n')
  let shown: string[] = []
  let left = CONTEXT
  for (let i = 0; i < hits; i++) {
    at += parts[i].length
    while (end >= 0 && end < at) {
      line++
      start = end + 1
      end = text.indexOf('\n', start)
    }
    let row = `line ${line}: ${
      excerpt(text, at, start, end < 0 ? text.length : end)
    }`
    if (row.length + 1 > left) break
    shown.push(row)
    left -= row.length + 1
    at += find.length
  }
  if (hits > shown.length) shown.push(`${hits - shown.length} more matches`)
  return shown.join('\n')
}

let patched = (was: string, { find, replace }: Edit, where: string) => {
  let parts = was.split(find)
  let hits = parts.length - 1
  if (hits == 1) {
    return { text: parts.join(replace), line: parts[0].split('\n').length }
  }
  let found =
    `find matched ${hits} times in ${where} — a patch replaces exactly one`
  if (!hits) {
    throw new CallError(
      'arguments',
      found + ': read the file back and copy the text exactly',
    )
  }
  throw new CallError(
    'arguments',
    found + '. Add surrounding text to find so it matches one place.',
    locations(was, find, parts),
  )
}

/** Apply exact, literal replacements in order. A refusal leaves the input
 * untouched. The line numbers refer to what each edit saw. */
export let patching = (
  texts: Record<string, string>,
  list: Edit[],
  missing = (path: string, where: string) =>
    noFile(path, Object.keys(texts), undefined, undefined, where),
) => {
  let now = { ...texts }
  let lines = list.map((edit, i) => {
    let { path } = edit
    let where = list.length > 1 ? `${path} (edits[${i}])` : path
    if (!Object.hasOwn(now, path)) {
      throw new CallError('missing', missing(path, where))
    }
    let { text, line } = patched(now[path], edit, where)
    now[path] = text
    return line
  })
  return { texts: now, lines }
}
