// One session answer describes named graph outputs. Parse and validate that
// data before the effect boundary writes it as one graph change. Output ids
// come from builder, variant and slot; the model never chooses an eid.

import { type Bundle, type Comp, type Eid, token, type Tx } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { and, eq, present } from '@yaks/query'
import { EDGE, link, unlink } from '@yaks/edge'
import { verify } from '@yaks/kernel'
import { BUILD, BUILT, output } from './build.ts'

export type Spec = {
  slot: string
  inputs: Eid[]
  components: Record<string, Comp | null>
  media?: { artifact: Eid; media_type: string }
}

let object = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v == 'object' && !Array.isArray(v)
let str = (v: unknown): string => v == null ? '' : String(v)
let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

/** The graph-shaped answer contract, checked before any output is written. */
export let parse = (
  body: string,
  selected: Eid[],
  vocab: Vocab,
): Spec[] => {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new Error('builder answer must be a JSON object with outputs')
  }
  if (!object(data) || !Array.isArray(data.outputs)) {
    throw new Error('builder answer must have an outputs array')
  }
  let allowed = new Set(selected)
  let slots = new Set<string>()
  let out: Spec[] = []
  for (let item of data.outputs) {
    if (
      !object(item) || typeof item.slot != 'string' || !item.slot ||
      slots.has(item.slot) || !Array.isArray(item.inputs) ||
      !object(item.components)
    ) {
      throw new Error('each output needs a unique slot, inputs and components')
    }
    slots.add(item.slot)
    let inputs: Eid[] = []
    for (let eid of item.inputs) {
      if (typeof eid != 'string' || !allowed.has(eid)) {
        throw new Error(
          `${item.slot} cites an input its builder did not select`,
        )
      }
      if (!inputs.includes(eid)) inputs.push(eid)
    }
    let components: Record<string, Comp | null> = {}
    for (let [name, value] of Object.entries(item.components)) {
      let info = vocab.comp(name)
      if (
        !info?.wire || [BUILD, BUILT, 'builder', EDGE].includes(name) ||
        (value != null && !object(value))
      ) {
        throw new Error(`${item.slot} has no writable ${name} component`)
      }
      if (value != null) {
        for (let prop of Object.keys(value)) {
          if (!info.writable.includes(prop)) {
            throw new Error(`${item.slot} cannot write ${name}.${prop}`)
          }
        }
      }
      components[name] = value as Comp | null
    }
    out.push({ slot: item.slot, inputs, components })
  }
  return out
}

/** All output patches for one answer, with the run's session as a guard. */
export let answer = async (
  tx: Tx,
  run: Bundle,
  body: string | Spec[],
  vocab: Vocab,
): Promise<Bundle[]> => {
  let b = comp(run, BUILD)
  let builder = str(b?.builder)
  let variant = str(b?.variant)
  let session = str(b?.session)
  let selected = Array.isArray(b?.inputs) ? b.inputs.map(str) : []
  let specs = typeof body == 'string' ? parse(body, selected, vocab) : body
  let ids = specs.map((s) => output(builder, s.slot, variant))
  let prior = await tx.get(ids)
  let have = new Map(prior.map((b) => [b.entity.eid, b]))
  let targets = await tx.get([...new Set(specs.flatMap((s) => s.inputs))])
  let found = new Map(targets.map((b) => [b.entity.eid, b]))
  let writes: Bundle[] = [{
    entity: { eid: run.entity.eid },
    [BUILD]: { session },
    $was: { [BUILD]: { session: token(session) } },
  }]
  for (let spec of specs) {
    let eid = output(builder, spec.slot, variant)
    let before = have.get(eid)
    writes.push({
      entity: { eid },
      ...spec.components,
      [BUILT]: {
        builder,
        variant,
        slot: spec.slot,
        key: b?.key,
        ...(b?.model ? { model: b.model } : {}),
        session,
        artifact: spec.media?.artifact ?? null,
        media_type: spec.media?.media_type ?? null,
      },
      $was: { [BUILT]: { session: token(comp(before, BUILT)?.session) } },
    })
    let citations = await tx.read(
      and(eq(`${EDGE}.from`, eid), present('cites')),
    )
    for (let cited of citations) {
      let to = str(comp(cited, EDGE)?.to)
      if (to && !spec.inputs.includes(to)) {
        writes.push({ ...unlink(eid, 'cites', to), verified: null })
      }
    }
    for (let to of spec.inputs) {
      let target = found.get(to)
      if (!target) throw new Error(`${spec.slot} cites missing input ${to}`)
      let cite = link(eid, 'cites', to)
      writes.push({ ...cite, ...verify(cite, target, vocab) })
    }
  }
  return writes
}

/** An artifact reply becomes one output citing the one row it came from. */
export let media = async (
  tx: Tx,
  run: Bundle,
  said: Bundle,
): Promise<Spec[]> => {
  let b = comp(run, BUILD)
  let inputs = b?.inputs
  let eid = str(comp(said, 'attachment')?.artifact)
  if (!Array.isArray(inputs) || inputs.length != 1 || !eid) {
    throw new Error('artifact builder needs one input and one attachment')
  }
  let [source, artifact] = await tx.get([str(inputs[0]), eid])
  let type = str(comp(artifact, 'artifact')?.media_type)
  if (!source || !type) throw new Error('builder artifact or input is missing')
  return [{
    slot: 'main',
    inputs: [source.entity.eid],
    components: {
      doc: {
        title: str(comp(source, 'doc')?.title),
        body: str(b?.prompt),
      },
    },
    media: { artifact: eid, media_type: type },
  }]
}
