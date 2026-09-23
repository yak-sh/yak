// Find-and-replace edits to a text property, shared by the `$edit` field
// operator and by any handler that accepts a patch format.
import { type Bundle, comps, dead } from './bundle.ts'
import { token } from './guard.ts'
import type { Plugin } from './plugin.ts'

// One replacement: swap `old` for `new`, requiring a unique match unless `all`
// is set — the same contract a file-editing tool uses. A `$edit` field carries
// one of these or a list of them; a V4A patch section parses into a list.
export type EditHunk = { old: string; new: string; all?: boolean }

// Apply a sequence of replacements to `value`, requiring each match to be
// unique unless `all` is set, and throwing rather than replacing the wrong
// occurrence. `where` names the property, for the error message. A result equal
// to the input throws — an edit that changes nothing is a mistake, not a
// no-op. Pure: no database, no hashing, just the string.
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

// A `$edit` field-operator payload → the replacements it describes.
// `{ old, new, all? }`, or a list of them for a multi-part patch. It is the
// same find-and-replace form a file-editing tool takes, carried as a property
// value inside an ordinary bundle rather than needing a tool of its own.
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

// Is this property value a `$edit` field operator rather than a literal? That
// is, a plain object carrying a `$edit` key. `apply()` detects it, reads the
// property's current value, and writes the patched result with a `$was`
// precondition.
export let isEditOp = (v: unknown): v is { $edit: unknown } =>
  v != null && typeof v == 'object' && !Array.isArray(v) && '$edit' in v

// Is this property value any field operator — a plain object with a
// `$`-prefixed key? Every real property value is a scalar, so a `$`-keyed
// object must be an operator: one `apply()` knows and resolves, or a typo
// `apply()` should refuse with a clear message rather than hand to storage as a
// non-scalar.
export let isFieldOp = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v == 'object' && !Array.isArray(v) &&
  Object.keys(v as object).some((k) => k.startsWith('$'))

/** What the calling program must supply for field edits. Its reads have to
 * stay stable through the commit: `normalize` runs before the core opens its
 * transaction, so a program backed by a database must wrap `graph.apply` in a
 * write transaction of its own. Values come back as plain text. */
export type EditHost = {
  /** A declared component's value as it is stored, never a value written
   * earlier in the same change. */
  component: (eid: string, name: string) => Record<string, unknown> | undefined
  /** Whether this is a declared, client-writable text property. */
  text: (name: string, prop: string) => boolean
  /** Whether the vocabulary declares this component; an undeclared one stays
   * admission's forward-compatible no-op. */
  known: (name: string) => boolean
  /** Optional: a human-readable name for an entity, for refusal messages. */
  name?: (eid: string) => string
}

/** Resolve field operators in order, without mutating the caller's bundles. A
 * literal written earlier in the change feeds a later edit to the same
 * property; removing a component discards the pending values for that entity,
 * so the next edit reads the stored value again. Each edit adds a `$was`
 * precondition describing the stored value; a precondition the caller supplied
 * is never overwritten. */
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
      for (let [prop, value] of Object.entries(patch)) {
        let key = `${eid}\0${name}\0${prop}`
        if (isFieldOp(value) && host.known(name)) {
          let where = `${host.name?.(eid) ?? eid}.${name}.${prop}`
          if (!isEditOp(value)) {
            let op = Object.keys(value).find((k) => k.startsWith('$'))
            throw new Error(`${where}: unknown operator ${JSON.stringify(op)}`)
          }
          if (!host.text(name, prop)) {
            throw new Error(
              `$edit: ${where} is not a wire-writable text property`,
            )
          }
          if (!read) {
            found = host.component(eid, name)
            read = true
          }
          let stored = found?.[prop]
          let cur = pending.has(key) ? pending.get(key) : stored
          if (typeof cur != 'string') {
            throw new Error(`$edit: ${where} has no text value to edit`)
          }
          comp[prop] = patchText(cur, editHunks(value.$edit), where)
          let was = { ...out.$was?.[name] }
          if (!(prop in was)) was[prop] = token(stored)
          out.$was = { ...out.$was, [name]: was }
        }
        pending.set(key, comp[prop])
      }
      out[name] = comp
    }
    return out
  })
}

/** A plugin that resolves field edits in the `normalize` phase; see
 * {@link EditHost} for what the calling program must guarantee. */
export let edits = (host: EditHost): Plugin => ({
  name: 'graph/edits',
  hooks: { normalize: (bundles) => resolveEdits(bundles, host) },
})
