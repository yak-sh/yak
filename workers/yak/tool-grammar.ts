// Kept app releases still declare the old command grammar. Translate it at
// the platform boundary; the packages and callers share the new declaration.
import { CallError } from '@yaks/tools'
import { parseTools, type Tools } from '@yaks/tools/declared'
import { validateToolInput } from '@yaks/vocab/tools'

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

let legacy = {
  type: 'object',
  additionalProperties: false,
  properties: {
    positional: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    rest: { type: 'string' },
    short: {
      type: 'object',
      propertyNames: { pattern: '^[a-zA-Z]$' },
      additionalProperties: { type: 'string' },
    },
  },
}

let translated = (entry: unknown, name: string): unknown => {
  if (!object(entry) || !('options' in entry)) return entry
  let { options, ...next } = entry
  if (options == null) return next
  try {
    if ('positional' in entry) {
      throw new Error('declare positional or the legacy options, never both')
    }
    let old = validateToolInput(
      { inputSchema: legacy },
      options as Record<string, unknown>,
    ) as {
      positional?: string[]
      rest?: string
      short?: Record<string, string>
    }
    let positional = (old.positional ?? []).filter((name) => name != old.rest)
    if (old.rest) positional.push(`${old.rest}...`)
    if (old.positional || old.rest) next.positional = positional
    if (old.short) {
      let input = { ...(object(entry.input) ? entry.input : {}) }
      for (let [short, prop] of Object.entries(old.short)) {
        if (!object(input[prop])) {
          throw new Error(`short references unknown input: ${prop}`)
        }
        input[prop] = { ...input[prop], short }
      }
      next.input = input
    }
    return next
  } catch (error) {
    throw new CallError(
      'arguments',
      `${name}.options: ${(error as Error).message}`,
    )
  }
}

/** A manifest entering through deploy, including files a kept release holds. */
export let appTools = (
  source: unknown,
  words: string[] = [],
  file = 'vocab.json',
): Tools => {
  if (typeof source == 'string') {
    try {
      source = JSON.parse(source)
    } catch {
      return parseTools(source, words, file)
    }
  }
  if (object(source) && object(source.$defs)) {
    source = {
      ...source,
      $defs: Object.fromEntries(
        Object.entries(source.$defs).map(([name, entry]) => [
          name,
          object(entry) && entry.tool === true
            ? translated(entry, name)
            : entry,
        ]),
      ),
    }
  }
  return parseTools(source, words, file)
}

/** Stored commands predate this rename; adapt without rewriting their slots. */
export let readTools = (source: string): Tools =>
  Object.fromEntries(
    Object.entries(JSON.parse(source || '{}')).map(([name, entry]) => [
      name,
      translated(entry, name),
    ]),
  ) as Tools
