// One-time Vale sound migration. Convert a reconciled binding plan and the
// previous sound rows into one graph change; the caller applies it as the
// kernel after proving the same change on a copy of the store.

import { type Bundle, type Comp, identityEid } from '@yaks/graph'
import { link } from '@yaks/edge'

type Plan = {
  build: string
  match: string
  variant: string
  binding: { entities: (string | null)[]; vars: Record<string, unknown> }
  key: string
  to: string
  template: string
  using: Comp
}

type Snapshot = {
  builders: Bundle[]
  builds: Bundle[]
  outputs: Bundle[]
  sounds: Bundle[]
  artifacts: Bundle[]
  citations: Bundle[]
}

let get = (row: Bundle | undefined, name: string): Comp => {
  let value = row?.[name]
  if (!value || typeof value != 'object') throw new Error(`missing ${name}`)
  return value as Comp
}

let one = <T>(rows: T[], label: string): T => {
  if (rows.length != 1) {
    throw new Error(`${label}: expected one, got ${rows.length}`)
  }
  return rows[0]
}

let old = (row: Bundle): Bundle => ({
  entity: { eid: row.entity.eid },
  $delete: true,
})

/** Preserve completed sounds; missing outputs remain due for a new call. */
export let migrate = (
  before: Snapshot,
  definition: Bundle,
  plans: Plan[],
): Bundle[] => {
  let builder = definition.entity.eid
  let sound = new Map(before.sounds.map((row) => [row.entity.eid, row]))
  let artifact = new Set(before.artifacts.map((row) => row.entity.eid))
  let byOldBuilder = new Map(
    before.builders.map((row) => [row.entity.eid, row]),
  )
  let byInput = new Map(
    plans.map((p) => [one(p.binding.entities, 'binding'), p]),
  )
  if (byInput.size != plans.length || plans.length != sound.size) {
    throw new Error('one sound must have one planned build')
  }
  let writes: Bundle[] = [definition]
  for (let prior of before.builds) {
    let b = get(prior, 'build')
    let source = one(b.inputs as string[], 'build inputs')
    let sfx = sound.get(source)
    let p = byInput.get(source)
    let from = byOldBuilder.get(String(b.builder))
    if (
      !sfx || !p || !from || b.variant != 'main' || p.variant != 'main' ||
      get(from, 'builder').query != `.sfx.name=${get(sfx, 'sfx').name}` ||
      get(from, 'builder').model != get(definition, 'using').model ||
      `${get(from, 'doc').body}\n\n$description` !=
        get(definition, 'content').body ||
      p.match != JSON.stringify([source])
    ) {
      throw new Error(`legacy build ${prior.entity.eid} has no sound binding`)
    }
    let produced = before.outputs.filter((row) =>
      get(row, 'built').builder == from.entity.eid
    )
    if (produced.length > 1) throw new Error(`multiple outputs for ${source}`)
    let call = identityEid('call', [p.build, 'vale-sfx-migration'])
    let key = produced.length ? p.key : null
    writes.push({
      entity: { eid: p.build },
      build: {
        builder,
        match: p.match,
        variant: 'main',
        key,
        call,
        stale: false,
      },
    }, {
      entity: { eid: call },
      call: {
        to: p.to,
        source: p.build,
        args: {
          binding: p.binding,
          key: p.key,
          template: p.template,
          using: p.using,
        },
      },
      execution: { state: produced.length ? 'done' : 'failed' },
    })
    if (b.session) {
      writes.push({
        entity: { eid: String(b.session) },
        session: { source: call },
      })
    }
    if (!produced.length) continue
    let output = produced[0]
    let made = get(output, 'built')
    let blob = String(made.artifact)
    if (made.key != b.key || !artifact.has(blob)) {
      throw new Error(`legacy output ${output.entity.eid} lost its artifact`)
    }
    let citation = one(
      before.citations.filter((row) => {
        let edge = get(row, 'edge')
        return edge.from == output.entity.eid && edge.to == source
      }),
      `citation for ${source}`,
    )
    let eid = identityEid('built', [p.build, String(made.slot)])
    writes.push({
      entity: { eid },
      ...(output.doc ? { doc: output.doc } : {}),
      built: {
        build: p.build,
        slot: made.slot,
        key: p.key,
        call,
        artifact: blob,
      },
    }, {
      ...link(eid, 'cites', source),
      cites: get(citation, 'cites'),
      verified: {},
    })
  }
  if (
    before.builds.length != before.builders.length ||
    before.outputs.length != before.citations.length ||
    writes.filter((row) => row.built).length != before.outputs.length
  ) {
    throw new Error('legacy sound rows were not all carried')
  }
  return [
    ...writes,
    ...before.outputs.map(old),
    ...before.builds.map(old),
    ...before.builders.map(old),
  ]
}
