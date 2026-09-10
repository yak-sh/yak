// Portable surgical edits, shared by field operators and patch-format doors.
import { type Bundle, comps, dead } from './bundle.ts'
import { token } from './guard.ts'
import type { Plugin } from './plugin.ts'

// One surgical hunk: replace `old` with `new`, unique-or-`all` — the file Edit
// tool's contract. A `$edit` field carries one of these or a list; a V4A
// section parses into a list of them.
export type EditHunk = { old: string; new: string; all?: boolean }

// THE core: apply a sequence of surgical replacements to `value`, each match
// unique unless `all`, refusing rather than clobbering. `where` names the
// column for the error. A net-unchanged result refuses — an edit that writes
// nothing is a mistake, not a no-op. Pure: no db, no sha, just the string.
export let patchText = (
  value: string,
  hunks: EditHunk[],
  where: string,
): string => {
  let out = value
  for (let { old, new: replacement, all } of hunks) {
    if (!old) throw new Error('edit: the text to replace is empty')
    let hits = out.split(old).length - 1
    if (hits == 0) {
      throw new Error(`edit: not found in ${where}: ${JSON.stringify(old)}`)
    }
    if (hits > 1 && !all) {
      throw new Error(
        `edit: ${hits} matches in ${where} — pass replace_all/all, or ` +
          `include surrounding text to make the match unique`,
      )
    }
    out = all ? out.split(old).join(replacement) : out.replace(old, replacement)
  }
  if (out == value) {
    throw new Error('edit: the replacement leaves the value unchanged')
  }
  return out
}

// A `$edit` field-operator payload → hunks. `{ old, new, all? }`, or a list of
// them for a multi-hunk patch. This is Claude's own Edit idiom, riding a comp
// value in the bundle/change format instead of a bespoke tool.
export let editHunks = (op: unknown): EditHunk[] => {
  let one = (h: unknown): EditHunk => {
    if (!h || typeof h != 'object' || Array.isArray(h)) {
      throw new Error('$edit: each hunk is { old, new, all? }')
    }
    let { old, new: fresh, all } = h as Record<string, unknown>
    if (typeof old != 'string' || typeof fresh != 'string') {
      throw new Error('$edit: old and new must both be text')
    }
    return { old, new: fresh, ...(all === true ? { all: true } : {}) }
  }
  return Array.isArray(op) ? op.map(one) : [one(op)]
}

// Is this comp value a `$edit` field operator (rather than a literal)? A column
// value that is a plain object carrying `$edit`. apply() detects it, reads the
// current column, and lands the patched result with the was-guard.
export let isEditOp = (v: unknown): v is { $edit: unknown } =>
  v != null && typeof v == 'object' && !Array.isArray(v) && '$edit' in v

// Is this comp value ANY field operator — a plain object with a `$`-sigil key?
// Every real scalar is a literal, so a `$`-keyed object is an operator: a known
// one apply() resolves, or a typo apply() must refuse legibly rather than pass
// to storage as a non-scalar.
export let isFieldOp = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v == 'object' && !Array.isArray(v) &&
  Object.keys(v as object).some((k) => k.startsWith('$'))

/** The host of ordered field edits. Reads must be held stable through commit:
 * normalize runs BEFORE core opens its transaction, so a database host must
 * wrap graph.apply in its outer write transaction. Values are hydrated text. */
export type EditHost = {
  /** A known component's value as FOUND, never an earlier same-batch write. */
  component: (eid: string, name: string) => Record<string, unknown> | undefined
  /** Whether this is a declared, wire-writable text/body column. */
  text: (name: string, column: string) => boolean
  /** Unknown components remain admission's forward-compatible no-op. */
  known: (name: string) => boolean
  /** Optional human-readable identity for addressed refusal messages. */
  name?: (eid: string) => string
}

/** Resolve field operators in order, without mutating the caller's batch.
 * Literals feed later edits; explicit drops discard pending values for that
 * entity, restoring the stored-value fallback (the existing edit contract).
 * Auto guards describe FOUND state; an explicit caller guard is never erased. */
export let resolveEdits = (bundles: Bundle[], host: EditHost): Bundle[] => {
  let pending = new Map<string, unknown>()
  let drop = (eid: string) => {
    for (let key of pending.keys()) {
      if (key.startsWith(`${eid}\0`)) pending.delete(key)
    }
  }
  return bundles.map((b) => {
    let eid = b.entity.eid
    if (dead(b)) {
      drop(eid)
      return b
    }
    let out: Bundle = { ...b, ...(b.$was ? { $was: { ...b.$was } } : {}) }
    for (let [name, patch] of comps(b)) {
      if (patch == null) {
        drop(eid)
        continue
      }
      let comp = { ...patch }
      let found: Record<string, unknown> | undefined
      let read = false
      for (let [col, value] of Object.entries(patch)) {
        let key = `${eid}\0${name}\0${col}`
        if (isFieldOp(value) && host.known(name)) {
          let where = `${host.name?.(eid) ?? eid}.${name}.${col}`
          if (!isEditOp(value)) {
            let op = Object.keys(value).find((k) => k.startsWith('$'))
            throw new Error(`${where}: unknown operator ${JSON.stringify(op)}`)
          }
          if (!host.text(name, col)) {
            throw new Error(
              `$edit: ${where} is not a wire-writable text column`,
            )
          }
          if (!read) {
            found = host.component(eid, name)
            read = true
          }
          let stored = found?.[col]
          let cur = pending.has(key) ? pending.get(key) : stored
          if (typeof cur != 'string') {
            throw new Error(`$edit: ${where} has no text value to edit`)
          }
          comp[col] = patchText(cur, editHunks(value.$edit), where)
          let was = { ...out.$was?.[name] }
          if (!(col in was)) was[col] = token(stored)
          out.$was = { ...out.$was, [name]: was }
        }
        pending.set(key, comp[col])
      }
      out[name] = comp
    }
    return out
  })
}

/** A normalize plugin for field edits; see EditHost for the lock contract. */
export let edits = (host: EditHost): Plugin => ({
  name: 'graph/edits',
  hooks: { normalize: (bundles) => resolveEdits(bundles, host) },
})
