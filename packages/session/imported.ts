// One line of a harness's log, as the rows it becomes: what the importer
// (./tail.ts) writes for each line it reads, and what a host handed a run's
// lines rather than its file writes the same way (@yaks/spawn ./machines.ts).
// It reads no file, so a Worker imports it.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { derivedEid, identityEid } from '@yaks/graph/identity'
import { toolEid } from '@yaks/tools/result'
import { limitRows } from '@yaks/model'
import type { Comps, Said } from './readers.ts'

/** The entity a harness's call becomes, named by the harness's own id for it,
 * which is also what its result names. */
export let callOf = (session: Eid, id: string): Eid =>
  derivedEid(`call ${session} ${id}`)

/** The entry a model request becomes, named by the harness's own id for it,
 * which every line of its reply names again. */
export let askOf = (session: Eid, id: string): Eid =>
  derivedEid(`ask ${session} ${id}`)

/**
 * Whether an entry is prose: what a person typed (content alone), or what the
 * model said (content and the output that marks it).
 *
 * ```ts
 * import { prose } from '@yaks/session/tail'
 * import { assertEquals } from '@std/assert'
 *
 * assertEquals(prose({ content: { body: 'hi' } }), true)
 * assertEquals(prose({ content: { body: 'hmm' }, reasoning: {}, output: {} }), false)
 * ```
 */
export let prose = (c: Comps): boolean =>
  !!c.content && Object.keys(c).every((k) =>
    k == 'content' || k == 'output' ||
    (!!c.checkpoint && (k == 'checkpoint' || k == 'notice'))
  )

/** Selections retain the runner/model provenance of old imported sessions. */
export let retained = (c: Comps) => prose(c) || !!c.using

/** What a person typed: prose with no output beside it. */
export let typed = (c: Comps) => prose(c) && !c.output && !c.checkpoint

/** Two patches to one entity, as one. */
export let merge = (a: Bundle, b: Bundle): Bundle => {
  let out: Bundle = { ...a }
  for (let [k, v] of Object.entries(b)) {
    out[k] = v && typeof v == 'object' && !Array.isArray(v) && out[k]
      ? { ...out[k] as Comp, ...v as Comp }
      : v
  }
  return out
}

/**
 * One line, as the bundles it becomes: an entry for each thing it says, each
 * sitting at the line of the file it was read from, a row for each tool it
 * names, the answered call's state, and what it says about the session. A
 * prompt a person typed is signed by `person`.
 */
export let imported = (
  said: Said,
  o: {
    session: Eid
    /** the file the line is read from; a line handed over without its file
     * (@yaks/spawn ./machines.ts) sits at no file */
    file?: Eid
    /** the path it was opened at, which names the entries of a file other
     * than the session's first */
    path?: string
    line: number
    person?: Eid
    prose?: boolean
    own?: boolean
  },
): Bundle[] => {
  let { session, file, path, line } = o
  let key = o.own === false ? `${session} ${path}` : session
  let out = new Map<Eid, Bundle>()
  let put = (b: Bundle) => {
    let was = out.get(b.entity.eid)
    out.set(b.entity.eid, was ? merge(was, b) : b)
  }
  // A request comes before what it returned, wherever its reader put it, so
  // the reply ending a turn is its newest entry. Each entry keeps the name
  // its place in the line gives it.
  let asked = (c: Comps) => c.ask?.id != null
  let order = said.entries.map((c, i) => [c, i] as const)
  order = [
    ...order.filter(([c]) => asked(c)),
    ...order.filter(([c]) => !asked(c)),
  ]
  order.forEach(([c, i]) => {
    if (o.prose && !retained(c)) return
    let { call, result, execution, output, using, ask, ...rest } = c
    let row = (name: string, value: unknown) => {
      let eid = identityEid(name, [String(value)])
      put({ entity: { eid }, [name]: { name: String(value) } })
      return eid
    }
    if (using) {
      let refs: Comp = { ...using }
      for (let name of ['provider', 'model']) {
        if (using[name]) refs[name] = row(name, using[name])
      }
      rest.using = refs
    }
    let at = {
      entry: { session },
      ...file ? { lines: { file, start: line } } : {},
    }
    if (ask && ask.id == null) rest.ask = ask
    else if (ask) {
      let { id, to, ...asked } = ask
      put({
        entity: { eid: askOf(session, String(id ?? `${line} ${i}`)) },
        ...at,
        ask: { ...asked, ...(to ? { to: row('model', to) } : {}) },
        ...rest,
      })
      return
    }
    if (call) {
      let { to, ...asked } = call
      let name = String(to ?? '')
      if (name) put({ entity: { eid: toolEid(name) }, tool: { name } })
      put({
        entity: { eid: callOf(session, String(call.id)) },
        ...at,
        // The name it was called by stays beside the tool it names: a
        // provider that continues the conversation is not served that tool.
        call: { ...asked, ...(name ? { to: toolEid(name), name } : {}) },
        execution: { by: session },
        ...rest,
      })
      return
    }
    let answers = result && callOf(session, String(result.call))
    put({
      entity: { eid: derivedEid(`${key} ${line} ${i}`) },
      ...at,
      ...(answers ? { result: { ...result, call: answers } } : {}),
      ...(output ? { output: { ...output, source: session } } : {}),
      ...rest,
      ...(typed(c) && o.person
        ? { $actor: { by: o.person, via: session } }
        : {}),
    })
    if (answers && execution) put({ entity: { eid: answers }, execution })
  })
  if (said.about) put({ entity: { eid: session }, ...said.about })
  for (let b of limitRows(said.limits ?? [], said.at)) put(b)
  return [...out.values()]
}

/** A run of parts being joined: its key, the line of its first, and the
 * entry they make so far. */
export type Open = { key: string; line: number; entry: Comps }

/**
 * What a line says once the run of parts before it is joined, each with the
 * line its entries sit at: the run's entry at its first line, where this line
 * ends the run, then the line's own. A part of the run's key carries the run
 * on, and a part of another key starts one.
 *
 * ```ts
 * import { pieced } from '@yaks/session/tail'
 * import { assertEquals } from '@std/assert'
 *
 * let h = {}
 * let piece = (body: string) => ({ entries: [], part: { key: 'r', entry: { content: { body } } } })
 * pieced(h, piece('Hel'), 3)
 * pieced(h, piece('lo'), 4)
 * assertEquals(pieced(h, { entries: [{ stop: {} }] }, 5), [
 *   [{ entries: [{ content: { body: 'Hello' } }] }, 3],
 *   [{ entries: [{ stop: {} }] }, 5],
 * ])
 * ```
 */
export let pieced = (
  h: { part?: Open },
  said: Said,
  line: number,
): [Said, number][] => {
  let { part, ...own } = said
  let open = h.part
  if (part && open?.key == part.key) {
    let body = (c: Comps) => String(c.content?.body ?? '')
    open.entry = {
      ...open.entry,
      content: { body: body(open.entry) + body(part.entry) },
    }
    return [[own, line]]
  }
  h.part = part && { key: part.key, line, entry: part.entry }
  return open
    ? [[{ entries: [open.entry] }, open.line], [own, line]]
    : [[own, line]]
}
