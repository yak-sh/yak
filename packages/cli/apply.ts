// `yaks apply`: graph_apply with a door for a stream of bundles.
//
// A batch is atomic, and a file with fifty thousand bundles in it is not a
// batch anybody wants to be atomic — it is a load. So NDJSON on stdin, one
// bundle per line, goes over in chunks: each chunk is its own batch, applied
// or refused whole, and a line that is not JSON is named by its number rather
// than swallowing the file.
//
// A JSON array reads the same way, because that is what the tool takes anyway
// and a person pasting one should not have to reformat it.

/** How many bundles ride in one `graph_apply`. */
export let CHUNK = 50

/**
 * The bundles in a body: one JSON value per line, or a single JSON array.
 * Blank lines are nothing.
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
 * A list cut into batches.
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
