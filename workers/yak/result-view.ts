/** Small model-facing descriptions of JSON values kept whole in the graph. */
export let RESULT_LIMIT = 16_384
export let RESULT_MAX = 33_554_432
export let resultBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value) ?? 'null').length

let object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value == 'object' && !Array.isArray(value)
let names = (value: Record<string, unknown>) =>
  Object.keys(value).slice(0, 16).map((key) => key.slice(0, 48))
let rows = (
  value: unknown,
  path = '.',
  depth = 0,
): { value: unknown[]; path: string } | undefined => {
  if (Array.isArray(value)) return { value, path }
  if (!object(value)) return
  for (let key of ['result', 'rows', 'data', 'values']) {
    if (Array.isArray(value[key])) {
      return {
        value: value[key],
        path: path == '.' ? '.' + key : path + '.' + key,
      }
    }
  }
  if (depth >= 4) return
  for (let key of ['structuredContent', 'value']) {
    let table = rows(
      value[key],
      path == '.' ? '.' + key : path + '.' + key,
      depth + 1,
    )
    if (table) return table
  }
}
let shape = (value: unknown) => {
  let table = rows(value)
  return {
    type: value === null
      ? 'null'
      : Array.isArray(value)
      ? 'array'
      : typeof value,
    ...object(value) ? { keys: names(value) } : {},
    ...typeof value == 'string' ? { characters: value.length } : {},
    ...table
      ? {
        rows: table.value.length,
        path: table.path,
        columns: [
          ...new Set(
            table.value.slice(0, 3).flatMap((row) =>
              object(row) ? names(row) : []
            ),
          ),
        ].slice(0, 16),
      }
      : {},
  }
}
let sample = (value: unknown, depth = 0): unknown => {
  if (typeof value == 'string') {
    return value.length > 256 ? value.slice(0, 256) + '…' : value
  }
  if (depth >= 4 && value && typeof value == 'object') return '[…]'
  if (Array.isArray(value)) {
    return value.slice(0, 3).map((v) => sample(v, depth + 1))
  }
  if (!object(value)) return value
  return Object.fromEntries(
    Object.entries(value).slice(0, 8).map(([k, v]) => [
      k.slice(0, 80),
      sample(v, depth + 1),
    ]),
  )
}
let preview = (value: unknown) => {
  let out = sample(value)
  let text = JSON.stringify(out) ?? 'null'
  return resultBytes(out) > 4096 ? text.slice(0, 1000) + '…' : out
}

export type ResultSummary = {
  id: string
  bytes: number
  shape: ReturnType<typeof shape>
  preview: unknown
  message: string
}
export let resultSummary = (
  id: string,
  value: unknown,
  bytes = resultBytes(value),
): ResultSummary => ({
  id,
  bytes,
  shape: shape(value),
  preview: preview(value),
  message: 'The complete result is kept in this space’s graph. ' +
    'Use result_query({id, query}) with jq syntax to narrow it, or ' +
    'await results.read(id) inside code_mode. The preview is abbreviated.',
})

export let RESULT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    bytes: { type: 'number' },
    shape: { type: 'object' },
    preview: {},
    message: { type: 'string' },
    space: { type: 'string' },
    app: { type: 'string' },
    scope: { type: 'string' },
  },
  required: ['id', 'bytes', 'shape', 'preview', 'message'],
}
