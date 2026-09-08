/** Column actions parse input without touching a store or a host. */

import type { Bundle } from '@yaks/match'
import type { Column, Vocab } from '@yaks/vocab'
import { declared, writable } from './column.ts'
import type { Action } from './types.ts'

/** Applications may supply their value language and additional validation. */
export type EditOptions = {
  parse?: (input: unknown, column: Column, bundle: Bundle) => unknown
  validate?: (value: unknown, column: Column, bundle: Bundle) => void
}

type Address = { comp: string; col: string }

let fail = (c: Column, expected: string): never => {
  throw new Error(`${c.comp}.${c.prop} needs ${expected}`)
}

let decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

let parse = (input: unknown, c: Column): unknown => {
  if (input == null) return null
  let type = c.category == 'scalar' ? c.scalar : c.category
  // Empty text remains text; an empty optional scalar clears its column.
  if (
    input === '' && !['text', 'url', 'query', 'json'].includes(type!) &&
    !(type == 'enum' && c.values!.includes(''))
  ) {
    return null
  }
  if (type == 'number' || type == 'priority') {
    let text = typeof input == 'string' || typeof input == 'number'
      ? String(input).trim()
      : ''
    if (type == 'priority') text = text.replace(/^p/i, '')
    return decimal.test(text) && Number.isFinite(Number(text))
      ? Number(text)
      : fail(c, 'a finite decimal number')
  }
  if (type == 'bool') {
    if (input === true || input === 1 || input === 'true' || input === '1') {
      return true
    }
    if (input === false || input === 0 || input === 'false' || input === '0') {
      return false
    }
    return fail(c, 'a boolean')
  }
  if (typeof input != 'string') return fail(c, 'text')
  if (type == 'enum') {
    if (c.values!.includes(input)) return input
    let text = input.trim().toLowerCase()
    let alias = Object.entries(c.aliases ?? {})
      .find(([key]) => key.toLowerCase() == text)?.[1]
    return c.values!.find((v) =>
      v.toLowerCase() == (alias ?? text).toLowerCase()
    ) ??
      fail(c, `one of ${c.values!.join(', ')}`)
  }
  if (type == 'ref') return input.trim() || fail(c, 'an entity id')
  if (type == 'time') {
    // Explicit offsets avoid changing the instant with the host's timezone.
    let text = input.trim()
    let stamp =
      /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i
    let time = Date.parse(text)
    let day = text.slice(0, 10)
    // Date.parse normalizes February 31 into March; a timestamp must name an
    // existing calendar day before its timezone offset is applied.
    return stamp.test(text) && Number.isFinite(time) &&
        new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) == day
      ? new Date(time).toISOString()
      : fail(c, 'an ISO timestamp with a timezone')
  }
  return input
}

/**
 * Offer a single-column patch. Construction is inert; run parses, validates
 * and returns only that column. The host decides whether to apply the patch.
 */
export let edit = (
  vocab: Vocab,
  address: Address,
  options: EditOptions = {},
): Action => {
  let c = declared(vocab, address)
  return {
    name: `set ${c.comp}.${c.prop}`,
    run: (bundle, input) => {
      if (!writable(vocab, c)) {
        throw new Error(`${c.comp}.${c.prop} is read-only`)
      }
      let value = (options.parse ?? parse)(input, c, bundle)
      let errors = vocab.check(c.comp, { [c.prop]: value })
      if (errors.length) throw new Error(errors.join('; '))
      options.validate?.(value, c, bundle)
      return { [c.comp]: { [c.prop]: value } }
    },
  }
}
