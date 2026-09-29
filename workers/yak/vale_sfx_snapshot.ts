// One-time admin read of Vale's legacy sound rows before the builder schema
// changes. Each app's own Store supplies its rows; the sealed snapshot stays
// in the platform's private bucket until the migration finishes.

import type { Bundle } from '@yaks/graph'
import { ADMIN } from './lib/bots.ts'
import { appStore } from './directory.ts'
import { r2Objects } from './lib/objects.ts'
import { counts, seal, verified } from './vale_sfx_seal.ts'
import { type Args, type Ctx, refuse, type Tool } from './tool.ts'

let AUDIT = 'audit/vale-sfx-44666/stores/'
let APPS = new Set([
  '0f562744-e91e-4958-bfb7-1ef06af52dc2',
  '989e10e8-f6fe-411f-aefa-accdde8c2b7b',
  'a9bb6c62-7af5-49cd-9d13-c5f888be63e3',
  '9b237d64-e96e-47a9-ae56-f1993e5df3fc',
  '3017ecba-fed4-44a8-9899-17629a696f93',
])
let encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
let ordered = (rows: Bundle[]) =>
  rows.sort((a, b) => a.entity.eid.localeCompare(b.entity.eid))
let json = async (r: Response) => {
  if (!r.ok) throw new Error(`Store ${r.status}: ${await r.text()}`)
  return r.json()
}
let read = async (
  store: ReturnType<typeof appStore>,
  query: string,
): Promise<Bundle[]> =>
  await json(
    await store(
      `/query?q=${encodeURIComponent(query)}`,
      {},
      { 'x-yak-kernel': '1' },
    ),
  ) as Bundle[]
let snapshot = async (ctx: Ctx, args: Args) => {
  if (ctx.person != await ctx.dir.personAt(ADMIN)) {
    throw refuse('access', 'the platform admin owns this one-time snapshot')
  }
  let eid = String(args.app ?? '')
  if (!APPS.has(eid)) {
    throw refuse('arguments', 'app is outside Vale sound scope')
  }
  let found = await ctx.dir.appAt(eid)
  if (!found) throw refuse('missing', `app ${eid} is missing`)
  let { space, app } = found
  if (!app.store) throw refuse('missing', `app ${eid} has no Store`)
  let store = appStore(ctx.env.STORE, space, app)
  let [
    builders,
    builds,
    outputs,
    sounds,
    allArtifacts,
    allCites,
    vocab,
    recovery,
  ] = await Promise.all([
    read(store, '.builder&*'),
    read(store, '.build&*'),
    read(store, '.built&*'),
    read(store, '.sfx&*'),
    read(store, '.artifact&*'),
    read(store, '.cites&*'),
    json(await store('/vocab', {}, { 'x-yak-kernel': '1' })),
    json(await store('/restore', {}, { 'x-yak-kernel': '1' })),
  ])
  let made = new Set(outputs.map((row) => row.entity.eid))
  let blobs = new Set(
    outputs.map((row) =>
      String((row.built as { artifact?: string } | undefined)?.artifact ?? '')
    ),
  )
  let artifacts = allArtifacts.filter((row) => blobs.has(row.entity.eid))
  let citations = allCites.filter((row) =>
    made.has(String((row.edge as { from?: string } | undefined)?.from ?? ''))
  )
  let data = {
    at: new Date().toISOString(),
    app: eid,
    store: app.store,
    builders: ordered(builders),
    builds: ordered(builds),
    outputs: ordered(outputs),
    sounds: ordered(sounds),
    artifacts: ordered(artifacts),
    citations: ordered(citations),
    vocab,
    recovery,
  }
  let rows = counts(data)
  let key = `${AUDIT}${eid}.json`
  let proof = `${AUDIT}${eid}.seal.json`
  if (args.check === true) {
    return {
      text: `${space.slug}/${app.slug}: ${JSON.stringify(rows)}`,
      value: { ...rows, recovery },
    }
  }
  let raw = r2Objects(ctx.env.BLOBS)
  let prior = await raw.read(key)
  if (prior) {
    let held = await raw.read(proof)
    if (held) {
      await verified(
        prior,
        JSON.parse(new TextDecoder().decode(held)),
        eid,
        app.store,
      )
    }
    let before = JSON.parse(new TextDecoder().decode(prior)) as typeof data
    let rows = (d: typeof data) =>
      JSON.stringify([
        d.builders,
        d.builds,
        d.outputs,
        d.sounds,
        d.artifacts,
        d.citations,
        d.vocab,
      ])
    if (rows(before) != rows(data)) {
      throw refuse('conflict', `Store changed after snapshot ${key}`)
    }
    let stamped = await seal(prior, eid, app.store)
    if (!held) await raw.put(proof, encode(stamped))
    return {
      text: `snapshot already held at ${key}`,
      value: { ...stamped.counts, audit: key, seal: proof, sha: stamped.sha },
    }
  }
  let bytes = encode(data)
  let stamped = await seal(bytes, eid, app.store)
  await raw.put(key, bytes)
  await raw.put(proof, encode(stamped))
  return {
    text: `snapshotted ${space.slug}/${app.slug} at ${key}`,
    value: {
      ...stamped.counts,
      audit: key,
      seal: proof,
      sha: stamped.sha,
      recovery,
    },
  }
}

/** Removed after the one-time cutover. */
export let valeSnapshot: Tool = {
  name: 'vale_sfx_snapshot',
  title: 'Snapshot Vale sounds',
  description:
    'One-time platform-admin snapshot of legacy Vale sound Store rows.',
  destructive: true,
  input: {
    type: 'object',
    properties: {
      app: { type: 'string' },
      check: { type: 'boolean' },
    },
    required: ['app'],
  },
  run: snapshot,
}
