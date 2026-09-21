// `yak apply`: `graph_apply` fed from a stream of bundles.
//
// One batch is applied in one transaction, and a file with fifty thousand
// bundles in it is not something anybody wants in one transaction — it is a
// bulk load. So NDJSON on stdin, one bundle per line, is sent in chunks: each
// chunk is its own transaction, applied or rejected whole, and a line that is
// not JSON is reported by its line number rather than swallowing the file.
//
// A JSON array is read the same way, because that is the shape the tool takes
// anyway and a person pasting one should not have to reformat it.

/** How many bundles are sent in one `graph_apply` call. */
export let CHUNK = 50

/**
 * The bundles in a body: one JSON value per line, or a single JSON array.
 * Blank lines are ignored.
 *
 * ```ts
 * bundlesIn('{"a":1}\n\n{"b":2}\n') // [{a: 1}, {b: 2}]
 * ```
 */
export let bundlesIn = (body: string): unknown[] => {
  let text = body.trim()
  if (!text) return []
  if (text.startsWith('[')) {
    let whole = JSON.parse(text)
    if (!Array.isArray(whole)) throw new Error('that JSON is not an array')
    return whole
  }
  return text.split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line)
    .map(({ line, n }) => {
      try {
        return JSON.parse(line)
      } catch {
        throw new Error(`line ${n} is not JSON: ${line.slice(0, 80)}`)
      }
    })
}

/**
 * A list split into fixed-size chunks.
 *
 * ```ts
 * chunks([1, 2, 3], 2) // [[1, 2], [3]]
 * ```
 */
export let chunks = <T>(xs: T[], size = CHUNK): T[][] => {
  let out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}
