import { clips as clipLoader } from '@yaks/stage/samples'

// Hosted builder outputs supply every sound clip. A missing or undecodable
// blob leaves the procedural voice in place.
let clips: Record<string, string> = {}

/** Each chosen main recording, with its sound row and clip beside it. */
export let SOUNDS = '.built.current=true&.built.artifact' +
  '&.built.build.build.variant=main&.fields=built.current,' +
  'built.build.build.variant,built.build.build.for.sfx.name,' +
  'built.build.build.for.built.build,' +
  'built.artifact.artifact.address,built.artifact.artifact.media_type'

export type Row = {
  entity: { eid: string }
  built?: { build: string; artifact?: string; current?: boolean }
  build?: { for?: string; variant?: string }
  sfx?: { name: string }
  artifact?: { address: string; media_type: string }
}

/** Recordings by sound eid. Seed sounds also have their fixed game names;
 * generated takes share names, so their names never select a recording. */
export let catalog = (rows: Row[]): Record<string, string> => {
  let at = new Map(rows.map((row) => [row.entity.eid, row]))
  return Object.fromEntries(rows.flatMap(({ built }) => {
    let build = built && at.get(built.build)?.build
    if (!built?.current || build?.variant != 'main') return []
    let made = build.for, sound = made ? at.get(made) : undefined
    if (!made || !sound?.sfx) return []
    let name = sound.sfx.name
    let blob = built?.artifact && at.get(built.artifact)?.artifact
    return blob && blob.media_type.startsWith('audio/')
      ? [[made, blob.address], ...sound.built ? [] : [[name, blob.address]]]
      : []
  }))
}

let waiting = new Map<string, Set<(hash: string) => void>>()
let watching: Promise<void> | null = null
/** Accept the current catalogue delivered by the store subscription. */
export let accept = (rows: Row[]) => {
  let current = catalog(rows)
  for (let name of Object.keys(clips)) {
    if (!(name in current)) delete clips[name]
  }
  for (let [name, hash] of Object.entries(current)) {
    clips[name] = hash
    for (let ready of waiting.get(name) ?? []) ready(hash)
    waiting.delete(name)
  }
}

/** Follow hosted outputs so a rebuilt description is heard on the next play. */
export let watch = () => {
  if (watching) return watching
  watching = import(new URL('api/client.js', document.baseURI).href)
    .then(({ subscribe }) => {
      subscribe(SOUNDS, (rows: Row[]) => {
        accept(rows)
      })
    })
    .catch((error) => {
      watching = null
      reportError(error)
    })
  return watching
}

let address = (name: string): Promise<string> => {
  if (clips[name]) return Promise.resolve(clips[name])
  void watch()
  return new Promise((ready) => {
    let group = waiting.get(name) ?? new Set()
    group.add(ready)
    waiting.set(name, group)
  })
}

let decoded = clipLoader((error) => reportError(error))
let url = (hash: string) => new URL(`api/blob/${hash}`, document.baseURI)

export let loaded = (ctx: BaseAudioContext, name: string) =>
  clips[name] ? decoded.loaded(ctx, url(clips[name])) : undefined

// Waiting for a graph output is app-specific; decoding its URL is not.
let pending = new WeakMap<
  AudioContext,
  Map<string, Promise<AudioBuffer | null>>
>()
export let load = (ctx: AudioContext, name: string) => {
  let ready = loaded(ctx, name)
  if (ready) return Promise.resolve(ready)
  let group = pending.get(ctx)
  if (!group) pending.set(ctx, group = new Map())
  let found = group.get(name)
  if (found) return found
  let work = (async () => {
    try {
      let hash = await address(name)
      let buffer = await decoded.load(ctx, url(hash))
      return clips[name] == hash ? buffer : null
    } finally {
      group.delete(name)
    }
  })()
  group.set(name, work)
  return work
}
