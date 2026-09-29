// A command's structured answer as readable Markdown. The answer remains data
// for clients that parse it; this is only its written face for people.
import { h, markdown } from '@yaks/text'

let object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value == 'object' && !Array.isArray(value)

let fields = (value: Record<string, unknown>, path = ''): [string, unknown][] =>
  Object.entries(value).flatMap(([name, entry]) => {
    let key = path ? `${path}.${name}` : name
    return object(entry) && Object.keys(entry).length
      ? fields(entry, key)
      : [[key, entry]]
  })

let value = (entry: unknown) =>
  h('code', null, JSON.stringify(entry) ?? 'undefined')

let row = (entry: unknown, number?: number) => {
  let title = number == null ? null : h('h4', null, `Result ${number}`)
  let body = object(entry)
    ? h(
      'ul',
      null,
      ...fields(entry).map(([key, cell]) =>
        h('li', null, h('strong', null, key), ': ', value(cell))
      ),
    )
    : h('p', null, value(entry))
  return h('div', null, title, body)
}

/** Show JSON-shaped values as fields, one section per result. */
export let display = (answer: unknown): string =>
  Array.isArray(answer)
    ? answer.length
      ? answer.map((entry, i) => markdown(row(entry, i + 1))).join('\n\n')
      : 'No rows.'
    : markdown(row(answer))
