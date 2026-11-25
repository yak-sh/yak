import { CallError } from '@yaks/tools/errors'
import { noFile } from './versions.ts'

export type Edit = {
  path: string
  find: string
  replace: string
  all?: boolean
}

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

let patched = (
  was: string,
  { find, replace, all }: Edit,
  where: string,
  entry?: string,
) => {
  let parts = was.split(find)
  let hits = parts.length - 1
  if (hits == 1 || (all && hits > 0)) {
    return {
      text: parts.join(replace),
      line: parts[0].split('\n').length,
      hits,
    }
  }
  let found = `find matched ${hits} times in ${where}`
  if (!hits) {
    throw new CallError(
      'arguments',
      entry
        ? found +
          '. Edits apply in order. Make find match the text left by any earlier edits.'
        : found + (all ? ' —' : ' — a patch replaces exactly one:') +
          ' read the file back and copy the text exactly',
    )
  }
  throw new CallError(
    'arguments',
    found + '. Add surrounding text to find so it matches one place, or set ' +
      `all: true${entry ? ` on ${entry}` : ''} to replace every match.`,
    locations(was, find, parts),
  )
}

/** Apply exact, literal replacements in order. A refusal leaves the input
 * untouched. The line numbers refer to what each edit saw. */
export let patching = (
  texts: Record<string, string>,
  list: Edit[],
  {
    batch = list.length > 1,
    missing = (path: string, where: string) =>
      noFile(path, Object.keys(texts), undefined, undefined, where),
  } = {},
) => {
  let now = { ...texts }
  let results = list.map((edit, i) => {
    let { path } = edit
    let entry = batch ? `edits[${i}]` : undefined
    let where = entry ? `${path} (${entry})` : path
    if (!Object.hasOwn(now, path)) {
      throw new CallError('missing', missing(path, where))
    }
    let { text, line, hits } = patched(now[path], edit, where, entry)
    now[path] = text
    return { path, line, hits }
  })
  return { texts: now, results }
}
