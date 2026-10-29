// Changes expressed as fields and text operations, compiled to ordinary
// guarded patches. The transaction still owns addressing and admission.
import type { Bundle, Comp } from './bundle.ts'
import type { Graph } from './graph.ts'
import { Refused } from './errors.ts'
import { token } from './sha256.ts'
import { patchText } from './edit.ts'
import { merged } from './gather.ts'

/** A literal text change, in the order replace, prepend, append. */
export type TextEdit = {
  path: string
  find?: string
  replace?: string
  prepend?: string
  append?: string
  all?: boolean
  was?: string | null
}

/** Fields use component.property paths; a component alone accepts object/null. */
export type Edit = {
  id: string
  set?: Record<string, unknown>
  text?: TextEdit[]
  was?: Record<string, string | null>
  delete?: boolean
}

/** Literal replacement has the same semantics for every document. */
export let textEdited = (current: string, edit: TextEdit): string => {
  let { find, replace, all, prepend = '', append = '' } = edit
  if (find !== undefined) {
    try {
      current = patchText(
        current,
        [{ old: find, new: replace ?? '', all }],
        edit.path,
      )
    } catch (error) {
      throw new Refused(error instanceof Error ? error.message : String(error))
    }
  } else if (replace !== undefined) current = replace
  return prepend + current + append
}

let pathOf = (path: string): string[] => {
  let parts = path.split('.')
  if (
    parts.length > 2 ||
    parts.some((p) =>
      !p || p.startsWith('$') ||
      ['__proto__', 'prototype', 'constructor'].includes(p)
    ) || parts[0] == 'entity'
  ) throw new Refused(`expected component.property or component: ${path}`)
  return parts
}

let valueAt = (b: Bundle | undefined, comp: string, prop: string): unknown =>
  (b?.[comp] as Comp | undefined)?.[prop]

let put = (b: Bundle, path: string, value: unknown): Bundle => {
  let [comp, prop] = pathOf(path)
  if (!prop) return { ...b, [comp]: value } as Bundle
  return { ...b, [comp]: { ...b[comp] as Comp, [prop]: value } }
}

/** Compile every edit together, reading each source text once. Guards compare
 * the initial stored text, including when several edits touch the same field. */
export let edited = async (graph: Graph, edits: Edit[]): Promise<Bundle[]> => {
  let ids = edits.some((edit) => edit.text?.length)
    ? [...new Set(edits.map((edit) => edit.id))]
    : []
  let named = ids.filter((id) => !id.startsWith('$'))
  let addresses = named.length
    ? await graph.address(named)
    : new Map<string, string>()
  let idOf = (id: string) => addresses.get(id) ?? id
  let reading = [
    ...new Set(
      edits.filter((edit) => edit.text?.length)
        .map((edit) => idOf(edit.id)).filter((id) => !id.startsWith('$')),
    ),
  ]
  let stored = new Map(
    (reading.length ? await graph.get(reading) : []).map((
      b,
    ) => [b.entity.eid, b]),
  )
  let patches: Bundle[] = []
  let pending = new Map<string, Bundle>()
  let explicit = new Map<string, string | null>()
  let guard = (id: string, path: string, was: string | null) => {
    let key = `${id}\0${path}`
    if (explicit.has(key) && explicit.get(key) !== was) {
      throw new Refused(`conflicting was values for ${id}.${path}`)
    }
    explicit.set(key, was)
  }
  for (let edit of edits) {
    let id = idOf(edit.id)
    let patch: Bundle = { entity: { eid: id } }
    let state = pending.get(id) ?? stored.get(id) ?? patch
    for (let [path, was] of Object.entries(edit.was ?? {})) {
      let [comp, prop] = pathOf(path)
      if (!prop) throw new Refused(`was needs component.property: ${path}`)
      guard(id, path, was)
      patch.$was = {
        ...patch.$was,
        [comp]: { ...patch.$was?.[comp], [prop]: was },
      }
    }
    for (let [path, value] of Object.entries(edit.set ?? {})) {
      let [comp] = pathOf(path)
      if (patch[comp] === null && (path.includes('.') || value !== null)) {
        let reset: Bundle = { entity: { eid: id }, [comp]: null }
        patches.push(reset)
        state = merged(state, reset)
      }
      patch = put(patch, path, value)
    }
    state = merged(state, patch)
    for (let change of edit.text ?? []) {
      let [comp, prop] = pathOf(change.path)
      if (!prop) {
        throw new Refused(`text needs component.property: ${change.path}`)
      }
      let initial = valueAt(stored.get(id), comp, prop)
      let current = valueAt(state, comp, prop)
      if (current != null && typeof current != 'string') {
        throw new Refused(`${change.path} is not text`)
      }
      if (patch[comp] === null) {
        patches.push({ entity: { eid: id }, [comp]: null })
      }
      patch = put(patch, change.path, textEdited(String(current ?? ''), change))
      let guards = patch.$was?.[comp] ?? {}
      if (change.was !== undefined) guard(id, change.path, change.was)
      let key = `${id}\0${change.path}`
      patch = {
        ...patch,
        $was: {
          ...patch.$was,
          [comp]: {
            ...patch.$was?.[comp],
            [prop]: explicit.has(key)
              ? explicit.get(key)!
              : Object.hasOwn(guards, prop)
              ? guards[prop]
              : token(initial),
          },
        },
      }
      state = merged(state, patch)
    }
    if (edit.delete) patch.$delete = true
    patches.push(patch)
    pending.set(id, state)
  }
  return patches
}
