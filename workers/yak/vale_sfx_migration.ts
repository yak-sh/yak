// One-time admin door for the Vale sound cutover. It is removed after the
// migration; ordinary Store and release doors keep no legacy translation.

import { type Bundle } from '@yaks/graph'
import { key, run } from '@yaks/builders'
import { type Files, pins, sha256 } from './versions.ts'
import { r2Objects } from './lib/objects.ts'
import { ADMIN } from './lib/bots.ts'
import { appStore } from './directory.ts'
import { configured } from './deploy_worker.ts'
import { compiled } from './esbuild.ts'
import { releaseFiles, staged } from './release.ts'
import { type Index, indexOf, META } from './release_index.ts'
import { appVocab } from './vocab.ts'
import { verified } from './vale_sfx_seal.ts'
import { type Args, type Ctx, refuse, type Tool } from './tool.ts'
import { batches, progress } from '../../bin/migrate-vale-sfx.ts'
import {
  NEW_DESCRIPTION,
  OLD_DESCRIPTION,
  repackage,
  soundVocab,
  type Version,
} from '../../bin/vale-sfx-releases.ts'

let VALE = '0f562744-e91e-4958-bfb7-1ef06af52dc2'
let APPS = new Set([
  VALE,
  '989e10e8-f6fe-411f-aefa-accdde8c2b7b',
  'a9bb6c62-7af5-49cd-9d13-c5f888be63e3',
  '9b237d64-e96e-47a9-ae56-f1993e5df3fc',
  '3017ecba-fed4-44a8-9899-17629a696f93',
])
let AUDIT = 'audit/vale-sfx-44666/'
let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let encode = (text: string) => new TextEncoder().encode(text)
let object = (value: unknown): Record<string, unknown> =>
  value && typeof value == 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
let say = (value: unknown) => String(value ?? '')
let description = (doc: unknown) =>
  say(
    (object(object(doc).$defs).sfx as { description?: string } | undefined)
      ?.description,
  )
let revisedVocab = (doc: unknown) => {
  if (description(doc) == NEW_DESCRIPTION) return null
  if (description(doc) != OLD_DESCRIPTION) {
    throw refuse('arguments', 'Store has an unfamiliar sound vocabulary')
  }
  return JSON.parse(decode(soundVocab(encode(JSON.stringify(doc)))))
}
let json = async (r: Response) => {
  if (!r.ok) throw new Error(`Store ${r.status}: ${await r.text()}`)
  return r.json()
}
let versionOf = (v: {
  eid: string
  version: number
  source?: string | null
  files: Files
}, app: string): Version => ({
  eid: v.eid,
  app,
  version: v.version,
  source: v.source ?? '',
  files: v.files,
})
let selected = async (ctx: Ctx, app: string) => {
  if (!APPS.has(app)) {
    throw refuse('arguments', 'app is outside Vale sound scope')
  }
  let found = await ctx.dir.appAt(app)
  if (!found) throw refuse('missing', `app ${app} is missing`)
  return found
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
let check = async (ctx: Ctx) => {
  if (ctx.person != await ctx.dir.personAt(ADMIN)) {
    throw refuse('access', 'the platform admin owns this one-time migration')
  }
}

let STAGED = [
  ...Array.from(
    { length: 9 },
    (_, i) => `data/sfx/${String(i + 1).padStart(2, '0')}.json`,
  ),
  'data/sfx/README.md',
  'samples.ts',
  'samples_test.ts',
]

let stage = async (ctx: Ctx, args: Args) => {
  let { space } = await selected(ctx, say(args.app) || VALE)
  let files = object(args.files)
  if (
    Object.keys(files).length != STAGED.length ||
    STAGED.some((path) => typeof files[path] != 'string')
  ) throw refuse('arguments', 'stage needs the twelve Vale sound source files')
  let definitions = STAGED.filter((path) => path.endsWith('.json')).flatMap(
    (path) =>
      (JSON.parse(say(files[path])) as Bundle[]).filter((row) => row.builder),
  )
  if (
    definitions.length != 1 ||
    definitions[0].entity.eid != '5914ddc9-63b3-49bb-bf27-7ed74e327353'
  ) {
    throw refuse('arguments', 'source files must contain the shared builder')
  }
  let raw = r2Objects(ctx.env.BLOBS)
  let pin = pins(raw, `${space.slug}/`)
  let hashes: Files = {}
  for (let path of STAGED) {
    let bytes = encode(say(files[path]))
    let sha = await sha256(bytes)
    await pin.put(sha, bytes)
    hashes[path] = sha
  }
  return { text: `staged ${STAGED.length} files`, value: { files: hashes } }
}

let scan = async (ctx: Ctx, args: Args) => {
  let { space, app } = await selected(ctx, say(args.app))
  let store = appStore(ctx.env.STORE, space, app)
  let builders = await read(store, '.builder&*')
  let builds = await read(store, '.build&*')
  let outputs = await read(store, '.built&*')
  let sounds = await read(store, '.sfx&*')
  let declared = await json(await store('/vocab', {}, { 'x-yak-kernel': '1' }))
  let recovery = await json(
    await store(
      '/restore',
      {},
      { 'x-yak-kernel': '1' },
    ),
  )
  return {
    text:
      `${space.slug}/${app.slug}: ${builders.length} builders, ${builds.length} builds, ${outputs.length} outputs, ${sounds.length} sounds`,
    value: {
      builders: builders.length,
      builds: builds.length,
      outputs: outputs.length,
      sounds: sounds.length,
      vocabulary: description(declared) == OLD_DESCRIPTION
        ? 'legacy'
        : description(declared) == NEW_DESCRIPTION
        ? 'shared'
        : 'other',
      recovery,
    },
  }
}

let migrateStore = async (ctx: Ctx, args: Args) => {
  let { space, app } = await selected(ctx, say(args.app) || VALE)
  if (!app.store) throw refuse('missing', `app ${app.eid} has no Store`)
  let raw = r2Objects(ctx.env.BLOBS)
  let audit = `${AUDIT}stores/${app.eid}.json`
  let proof = `${AUDIT}stores/${app.eid}.seal.json`
  let hashes = object(args.files)
  let source = await pins(raw, `${space.slug}/`).get(
    say(hashes['data/sfx/01.json']),
  )
  if (!source) throw refuse('missing', 'staged 01.json is missing')
  let definition = (JSON.parse(decode(source)) as Bundle[]).find((r) =>
    r.builder
  )
  if (!definition) throw refuse('arguments', 'shared builder is missing')
  let saved = await raw.read(audit)
  if (!saved) {
    throw refuse('missing', `legacy Store snapshot ${audit} is missing`)
  }
  let held = await raw.read(proof)
  if (!held) throw refuse('missing', `legacy Store seal ${proof} is missing`)
  let before = await verified(
    saved,
    JSON.parse(decode(held)),
    app.eid,
    app.store,
  ) as {
    app: string
    store: string
    builders: Bundle[]
    builds: Bundle[]
    outputs: Bundle[]
    sounds: Bundle[]
    artifacts: Bundle[]
    citations: Bundle[]
    vocab: unknown
  }
  let { builders, builds, outputs, sounds, artifacts, citations } = before
  let store = appStore(ctx.env.STORE, space, app)
  let [nowBuilders, nowBuilds, nowOutputs, nowSounds] = await Promise.all([
    read(store, '.builder&*'),
    read(store, '.build&*'),
    read(store, '.built&*'),
    read(store, '.sfx&*'),
  ])
  let blobs = new Set(artifacts.map((row) => row.entity.eid))
  let declared = await json(await store('/vocab', {}, { 'x-yak-kernel': '1' }))
  let nextVocab = revisedVocab(declared)
  let ids = (rows: Bundle[]) =>
    JSON.stringify(rows.map((row) => row.entity.eid).sort())
  let soundRows = (rows: Bundle[]) =>
    JSON.stringify(
      rows.map((row) => [row.entity.eid, row.doc, row.sfx])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    )
  if (
    !builders.length && !builds.length && !outputs.length &&
    !sounds.length
  ) {
    if (
      nowBuilders.length || nowBuilds.length || nowOutputs.length ||
      nowSounds.length
    ) throw refuse('conflict', 'empty Store changed after snapshot')
    if (args.check !== true && nextVocab) {
      await json(
        await store('/vocab', {
          method: 'POST',
          body: JSON.stringify(nextVocab),
        }, { 'x-yak-kernel': '1' }),
      )
    }
    return { text: `${space.slug}/${app.slug} has no sound builder rows` }
  }
  let [tool] = await read(
    store,
    `.eid=${say((definition.builder as { to: string }).to)}&*`,
  )
  if (!tool?.tool) throw refuse('missing', 'builder model tool is missing')
  let vocab = appVocab(declared)
  let plans = sounds.map((sound) => {
    let eid = sound.entity.eid
    let binding = {
      entities: [eid],
      vars: {
        sfx: eid,
        description: (sound.doc as { body: string }).body,
      },
    }
    return {
      build: run(definition.entity.eid, binding.entities),
      match: JSON.stringify(binding.entities),
      variant: 'main',
      binding,
      key: key(definition, tool, binding, new Map([[eid, sound]]), vocab),
      to: (definition.builder as { to: string }).to,
      template: (definition.content as { body: string }).body,
      using: definition.using as Record<string, unknown>,
    }
  })
  let parts = batches(
    { builders, builds, outputs, sounds, artifacts, citations },
    definition,
    plans,
  )
  let part = Number(args.part)
  if (!Number.isSafeInteger(part) || part < 1 || part > parts.length + 1) {
    throw refuse('arguments', `store part must be 1–${parts.length + 1}`)
  }
  let calls = new Set(
    parts.flat().filter((row) => row.call).map((row) => row.entity.eid),
  )
  let added = new Set(
    parts.flat().filter((row) => !row.$delete).map((row) => row.entity.eid),
  )
  let sessions = new Set(
    parts.flat().filter((row) => row.session).map((row) => row.entity.eid),
  )
  let cited = new Set([
    ...citations.map((row) => row.entity.eid),
    ...parts.flat().filter((row) => row.cites).map((row) => row.entity.eid),
  ])
  let observed = async () => {
    let [builder, build, built, cites, call, session, sfx, artifact] =
      await Promise.all([
        read(store, '.builder&*'),
        read(store, '.build&*'),
        read(store, '.built&*'),
        read(store, '.cites&*'),
        read(store, '.call&*'),
        read(store, '.session&*'),
        read(store, '.sfx&*'),
        read(store, '.artifact&*'),
      ])
    return {
      builder,
      build,
      built,
      cites: cites.filter((row) => cited.has(row.entity.eid)),
      call: call.filter((row) => calls.has(row.entity.eid)),
      session: session.filter((row) =>
        sessions.has(row.entity.eid) &&
        calls.has(say((row.session as { source?: string }).source))
      ),
      sfx,
      artifact: artifact.filter((row) => blobs.has(row.entity.eid)),
    }
  }
  let expected = (count: number) => {
    let rows = progress(
      { builders, builds, outputs, sounds, artifacts, citations },
      parts,
      count,
    )
    let find = (name: string) => rows.filter((row) => row[name])
    return {
      builder: find('builder'),
      build: find('build'),
      built: find('built'),
      cites: find('cites'),
      call: find('call'),
      session: find('session'),
    }
  }
  let same = (
    at: Awaited<ReturnType<typeof observed>>,
    want: ReturnType<typeof expected>,
  ) => {
    let audio = new Map(at.artifact.map((row) => [row.entity.eid, row]))
    if (
      ids(sounds) != ids(at.sfx) ||
      ids(artifacts) != ids(at.artifact) ||
      soundRows(sounds) != soundRows(at.sfx) ||
      artifacts.some((row) =>
        JSON.stringify(row.artifact) !=
          JSON.stringify(audio.get(row.entity.eid)?.artifact)
      )
    ) return false
    for (
      let name of [
        'builder',
        'build',
        'built',
        'cites',
        'call',
        'session',
      ] as const
    ) {
      if (ids(want[name]) != ids(at[name])) return false
    }
    let rows = (
      name: 'builder' | 'build' | 'built' | 'cites' | 'call' | 'session',
    ) => new Map(at[name].map((row) => [row.entity.eid, row]))
    let check = (
      name: 'builder' | 'build' | 'built' | 'cites' | 'call' | 'session',
      keys: string[],
    ) => {
      let current = rows(name)
      return want[name].every((row) => {
        if (
          !calls.has(row.entity.eid) &&
          !sessions.has(row.entity.eid) &&
          row.entity.eid != definition.entity.eid &&
          !added.has(row.entity.eid)
        ) return true
        let actual = object(current.get(row.entity.eid)?.[name])
        let planned = object(row[name])
        return keys.every((key) =>
          JSON.stringify(actual[key] ?? null) ==
            JSON.stringify(planned[key] ?? null)
        )
      })
    }
    let currentCites = rows('cites')
    let citationsMatch = want.cites.every((row) => {
      let actual = currentCites.get(row.entity.eid)
      return actual &&
        ['from', 'to'].every((key) =>
          object(actual.edge)[key] == object(row.edge)[key]
        ) &&
        Object.entries(object(row.cites)).every(([key, value]) =>
          object(actual.cites)[key] == value
        )
    })
    return citationsMatch &&
      check('builder', ['query', 'to', 'floor', 'immediate']) &&
      check('build', ['builder', 'match', 'variant', 'key', 'call', 'stale']) &&
      check('built', ['build', 'slot', 'key', 'call', 'artifact']) &&
      check('call', ['to', 'source', 'args']) &&
      check('session', ['source'])
  }
  let now = await observed()
  let at = Array.from({ length: parts.length + 1 }, (_, n) => n)
    .find((n) => same(now, expected(n)))
  let final = expected(parts.length)
  let activated = (state: Awaited<ReturnType<typeof observed>>) => {
    let shared = state.builder.find((row) =>
      row.entity.eid == definition.entity.eid
    )
    let oldBuilt = new Set(outputs.map((row) => row.entity.eid))
    let oldCites = new Set(citations.map((row) => row.entity.eid))
    return shared?.builder &&
      (shared.builder as { immediate?: boolean }).immediate === true &&
      ids(sounds) == ids(state.sfx) &&
      soundRows(sounds) == soundRows(state.sfx) &&
      ids(artifacts) == ids(state.artifact) &&
      ids(state.builder) == ids(final.builder) &&
      ids(state.build) == ids(final.build) &&
      !state.built.some((row) => oldBuilt.has(row.entity.eid)) &&
      !state.cites.some((row) => oldCites.has(row.entity.eid)) &&
      final.built.every((row) => {
        let kept = state.built.find((other) =>
          other.entity.eid == row.entity.eid
        )
        return kept &&
          (kept.built as { artifact?: string }).artifact ==
            (row.built as { artifact?: string }).artifact
      }) &&
      final.cites.every((row) =>
        state.cites.some((other) => other.entity.eid == row.entity.eid)
      )
  }
  if (activated(now)) at = parts.length + 1
  if (at == null) {
    throw refuse('conflict', 'Store differs from every sealed migration step')
  }
  if (at >= part) {
    if (part == parts.length + 1 && args.check !== true && nextVocab) {
      await json(
        await store('/vocab', {
          method: 'POST',
          body: JSON.stringify(nextVocab),
        }, { 'x-yak-kernel': '1' }),
      )
    }
    return { text: `Store part ${part}/${parts.length + 1} already applied` }
  }
  if (at != part - 1) {
    throw refuse('conflict', `Store is at part ${at}; next is ${at + 1}`)
  }
  let change = part <= parts.length ? parts[part - 1] : [{
    entity: definition.entity,
    builder: { floor: null, immediate: true },
  }]
  if (args.check === true) {
    return {
      text: `ready part ${part}/${
        parts.length + 1
      }: ${change.length} bundles; ${outputs.length} preserved artifacts`,
    }
  }
  await json(
    await store('/apply', {
      method: 'POST',
      body: JSON.stringify(change),
    }, { 'x-yak-kernel': '1' }),
  )
  let after = await observed()
  if (part <= parts.length && !same(after, expected(part))) {
    throw refuse('conflict', `Store part ${part} did not read back exactly`)
  }
  if (part == parts.length + 1) {
    if (!activated(after)) {
      throw refuse('conflict', 'shared builder did not activate')
    }
    if (nextVocab) {
      await json(
        await store('/vocab', {
          method: 'POST',
          body: JSON.stringify(nextVocab),
        }, { 'x-yak-kernel': '1' }),
      )
    }
  }
  return {
    text: `Store part ${part}/${parts.length + 1} applied and verified`,
  }
}

let repack = async (ctx: Ctx, args: Args) => {
  let { space, app } = await selected(ctx, say(args.app))
  let release = (await ctx.dir.deploys(app)).find((v) =>
    v.version == Number(args.version)
  )
  if (!release) throw refuse('missing', `v${args.version} is missing`)
  let version = versionOf(release, app.eid)
  let raw = r2Objects(ctx.env.BLOBS)
  let audit = `${AUDIT}releases/${version.eid}.json`
  let saved = await raw.read(audit)
  if (saved) {
    let proof = JSON.parse(decode(saved)) as {
      app: string
      before: { source: string; files: Files; index: unknown }
      after: { source: string; files: Files; index: unknown }
    }
    if (proof.app != app.eid) {
      throw refuse('conflict', `audit ${audit} names a different app`)
    }
    let oldIndex = proof.before.source
      ? await indexOf(raw, proof.before.source + '/')
      : null
    let newIndex = proof.after.source
      ? await indexOf(raw, proof.after.source + '/')
      : null
    let manifest = JSON.stringify(version.files)
    if (
      ![proof.before.source, proof.after.source].includes(version.source) ||
      ![JSON.stringify(proof.before.files), JSON.stringify(proof.after.files)]
        .includes(manifest) ||
      JSON.stringify(oldIndex) != JSON.stringify(proof.before.index) ||
      JSON.stringify(newIndex) != JSON.stringify(proof.after.index)
    ) {
      throw refuse(
        'conflict',
        `release v${version.version} changed after audit`,
      )
    }
    if (args.check === true) {
      let done = manifest == JSON.stringify(proof.after.files) &&
        version.source == proof.after.source
      return {
        text: `audited v${version.version}: ${
          done ? 'repackaged' : 'resumable'
        }`,
        value: { audit, files: proof.after.files },
      }
    }
    await ctx.dir.stamp({
      entities: [{
        entity: { eid: version.eid },
        deploy: {
          source: proof.after.source || null,
          files: JSON.stringify(proof.after.files),
        },
      }],
    })
    return { text: `repackaged v${version.version}; audit ${audit}` }
  }
  let pin = pins(raw, `${space.slug}/`)
  let oldVocab = await pin.get(version.files['vocab.json'])
  if (!oldVocab) throw refuse('missing', 'release vocabulary bytes are missing')
  let newVocab = soundVocab(oldVocab)
  let vocabSha = await sha256(newVocab)
  let replacements = object(args.files) as Files
  for (let [path, sha] of Object.entries(replacements)) {
    if (!await pin.has(sha)) {
      throw refuse('missing', `replacement ${path} is not pinned`)
    }
  }
  let [plan] = repackage([version], replacements, {
    [version.files['vocab.json']]: vocabSha,
  })
  if (!plan) throw refuse('arguments', 'release has no legacy sound files')
  if (!version.source) {
    if (args.check === true) {
      return {
        text:
          `ready v${version.version}: ${plan.changed.length} pinned source files; audit ${audit}`,
        value: { changed: plan.changed, audit },
      }
    }
    let original: Files = {}
    for (let path of plan.changed) {
      let sha = version.files[path]
      let bytes = await pin.get(sha)
      if (!bytes || await sha256(new Uint8Array(bytes)) != sha) {
        throw new Error(`original ${path} does not match its manifest`)
      }
      original[path] = sha
      await raw.put(`${AUDIT}sha/${sha}`, bytes)
    }
    await pin.put(vocabSha, newVocab)
    let proof = {
      at: new Date().toISOString(),
      deploy: version.eid,
      app: app.eid,
      version: version.version,
      before: { source: '', files: version.files, index: null, original },
      after: { source: '', files: plan.files, index: null },
    }
    await raw.put(audit, encode(JSON.stringify(proof)))
    await ctx.dir.stamp({
      entities: [{
        entity: { eid: version.eid },
        deploy: { files: JSON.stringify(plan.files) },
      }],
    })
    return {
      text:
        `repackaged v${version.version}; audit ${audit}; ${plan.changed.length} pinned source files changed`,
      value: { audit, files: plan.files },
    }
  }
  if (!version.source.startsWith(`${space.slug}/.releases/${app.eid}/`)) {
    throw refuse('arguments', 'release source does not match its asset address')
  }
  let held = await indexOf(raw, version.source + '/')
  let oldPaths = held
    ? Object.keys(held)
    : (await raw.list(version.source + '/')).map((key) =>
      key.slice(version.source.length + 1)
    )
  if (!oldPaths.length) throw refuse('missing', 'release has no source bytes')
  if (args.check === true) {
    return {
      text:
        `ready v${version.version}: ${plan.changed.length} source files; audit ${audit}`,
      value: { changed: plan.changed, audit },
    }
  }
  let candidate = `${space.slug}/.releases/${app.eid}/${crypto.randomUUID()}`
  let work = `${space.slug}/.drafts/vale-sfx-44666-${crypto.randomUUID()}`
  let next = await staged(raw, version.source, work, candidate, true)
  await pin.put(vocabSha, newVocab)
  for (let path of plan.changed) {
    let bytes = path == 'vocab.json'
      ? newVocab
      : await pin.get(plan.files[path])
    if (!bytes) throw refuse('missing', `replacement ${path} is not pinned`)
    await next.files.put(`${candidate}/${path}`, bytes)
  }
  let readFile = (path: string) => next.files.read(`${candidate}/${path}`)
  let parsed = await configured(readFile)
  let keys = (await next.files.list(`${candidate}/`)).map((path) =>
    path.slice(candidate.length + 1)
  )
  await compiled(
    ctx,
    space,
    { ...app, source: candidate },
    { person: ctx.person, role: 'owner' },
    parsed.config,
    keys,
    next.files,
    next.manifest,
  )
  let files = await next.finish()
  let newIndex = await raw.get(candidate + META)
  let oldIndex = await raw.read(version.source + META)
  let revised = JSON.parse(decode(newIndex)) as Index
  for (let path of [...STAGED, 'vocab.json']) {
    if (files[path] != plan.files[path]) {
      throw new Error(`repackaged ${path} does not match its staged bytes`)
    }
  }
  let prior = releaseFiles(raw)
  let original: Files = {}
  let changed = oldPaths.filter((path) =>
    !held?.[path]?.sha || held[path].sha != revised[path]?.sha
  )
  for (let path of changed) {
    let bytes = await prior.get(`${version.source}/${path}`)
    let sha = await sha256(bytes)
    if (held?.[path]?.sha && held[path].sha != sha) {
      throw new Error(`original ${path} does not match its index`)
    }
    if (version.files[path] && version.files[path] != sha) {
      throw new Error(`original ${path} does not match its manifest`)
    }
    original[path] = sha
    let backup = `${AUDIT}sha/${sha}`
    if (!await raw.has(backup)) {
      await raw.put(backup, bytes)
    }
  }
  let proof = {
    at: new Date().toISOString(),
    deploy: version.eid,
    app: app.eid,
    version: version.version,
    before: {
      source: version.source,
      files: version.files,
      index: oldIndex ? JSON.parse(decode(oldIndex)) : null,
      original,
    },
    after: { source: candidate, files, index: JSON.parse(decode(newIndex)) },
  }
  await raw.put(audit, encode(JSON.stringify(proof)))
  await ctx.dir.stamp({
    entities: [{
      entity: { eid: version.eid },
      deploy: { source: candidate, files: JSON.stringify(files) },
    }],
  })
  return {
    text:
      `repackaged v${version.version}; audit ${audit}; ${plan.changed.length} source files changed`,
    value: { audit, files },
  }
}

let restore = async (ctx: Ctx, args: Args) => {
  let { app } = await selected(ctx, say(args.app))
  let release = (await ctx.dir.deploys(app)).find((v) =>
    v.version == Number(args.version)
  )
  if (!release) throw refuse('missing', `v${args.version} is missing`)
  let raw = r2Objects(ctx.env.BLOBS)
  let audit = `${AUDIT}releases/${release.eid}.json`
  let saved = await raw.read(audit)
  if (!saved) throw refuse('missing', `audit ${audit} is missing`)
  let proof = JSON.parse(decode(saved)) as {
    app: string
    before: {
      source: string
      files: Files
      index: Index | null
      original: Files
    }
    after: { source: string; files: Files; index: Index | null }
  }
  if (proof.app != app.eid) {
    throw refuse('conflict', `audit ${audit} names a different app`)
  }
  let oldIndex = proof.before.source
    ? await indexOf(raw, proof.before.source + '/')
    : null
  let newIndex = proof.after.source
    ? await indexOf(raw, proof.after.source + '/')
    : null
  let files = JSON.stringify(release.files)
  if (
    ![proof.before.source, proof.after.source].includes(release.source ?? '') ||
    ![JSON.stringify(proof.before.files), JSON.stringify(proof.after.files)]
      .includes(files) ||
    JSON.stringify(oldIndex) != JSON.stringify(proof.before.index) ||
    JSON.stringify(newIndex) != JSON.stringify(proof.after.index)
  ) throw refuse('conflict', `release v${release.version} changed after audit`)
  if (args.check === true) {
    return { text: `ready to restore v${release.version} from ${audit}` }
  }
  for (let [path, sha] of Object.entries(proof.before.original)) {
    let bytes = await raw.read(`${AUDIT}sha/${sha}`)
    if (!bytes || await sha256(bytes) != sha) {
      throw refuse('missing', `audited ${path} bytes are missing`)
    }
  }
  await ctx.dir.stamp({
    entities: [{
      entity: { eid: release.eid },
      deploy: {
        source: proof.before.source || null,
        files: JSON.stringify(proof.before.files),
      },
    }],
  })
  return { text: `restored v${release.version} from ${audit}` }
}

/** Temporary platform-admin tool; remove with the one-time scripts. */
export let valeMigration: Tool = {
  name: 'vale_sfx_migrate',
  title: 'Migrate Vale sounds',
  description:
    'One-time platform-admin migration of Vale sound rows and retained releases.',
  destructive: true,
  input: {
    type: 'object',
    properties: {
      phase: { type: 'string' },
      app: { type: 'string' },
      version: { type: 'number' },
      files: { type: 'object' },
      part: { type: 'number' },
      check: { type: 'boolean' },
    },
    required: ['phase'],
  },
  run: async (ctx, args) => {
    await check(ctx)
    let phase = say(args.phase)
    if (phase == 'stage') return stage(ctx, args)
    if (phase == 'scan') return scan(ctx, args)
    if (phase == 'store') return migrateStore(ctx, args)
    if (phase == 'repack') return repack(ctx, args)
    if (phase == 'restore') return restore(ctx, args)
    throw refuse('arguments', `unknown Vale migration phase ${phase}`)
  },
}
