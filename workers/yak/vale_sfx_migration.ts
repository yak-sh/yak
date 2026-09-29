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
import { purged } from './files.ts'
import { releaseFiles, staged } from './release.ts'
import { indexOf, META } from './release_index.ts'
import { appVocab } from './vocab.ts'
import { type Args, type Ctx, refuse, type Tool } from './tool.ts'
import { migrate } from '../../bin/migrate-vale-sfx.ts'
import {
  repackage,
  soundVocab,
  type Version,
} from '../../bin/vale-sfx-releases.ts'

let VALE = '0f562744-e91e-4958-bfb7-1ef06af52dc2'
let AUDIT = 'audit/vale-sfx-44666/'
let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let encode = (text: string) => new TextEncoder().encode(text)
let object = (value: unknown): Record<string, unknown> =>
  value && typeof value == 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
let say = (value: unknown) => String(value ?? '')
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
  let found = await ctx.dir.appAt(app)
  if (!found) throw refuse('missing', `app ${app} is missing`)
  return found
}
let read = async (
  store: ReturnType<typeof appStore>,
  query: string,
): Promise<Bundle[]> =>
  await json(await store(
    `/query?q=${encodeURIComponent(query)}`,
    {},
    { 'x-yak-kernel': '1' },
  )) as Bundle[]
let check = async (ctx: Ctx) => {
  if (ctx.person != await ctx.dir.personAt(ADMIN)) {
    throw refuse('access', 'the platform admin owns this one-time migration')
  }
}

let STAGED = [
  ...Array.from({ length: 9 }, (_, i) =>
    `data/sfx/${String(i + 1).padStart(2, '0')}.json`
  ),
  'data/sfx/README.md',
  'samples.ts',
  'samples_test.ts',
]

let stage = async (ctx: Ctx, args: Args) => {
  let files = object(args.files)
  if (
    Object.keys(files).length != STAGED.length ||
    STAGED.some((path) => typeof files[path] != 'string')
  ) throw refuse('arguments', 'stage needs the twelve Vale sound source files')
  let data = JSON.parse(say(files['data/sfx/01.json'])) as Bundle[]
  if (data.filter((row) => row.builder).length != 1) {
    throw refuse('arguments', '01.json must contain the one shared builder')
  }
  let raw = r2Objects(ctx.env.BLOBS)
  let pin = pins(raw, 'yourname/')
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
  return {
    text: `${space.slug}/${app.slug}: ${builders.length} builders, ${builds.length} builds, ${outputs.length} outputs`,
    value: { builders: builders.length, builds: builds.length, outputs: outputs.length },
  }
}

let migrateStore = async (ctx: Ctx, args: Args) => {
  let { space, app } = await selected(ctx, VALE)
  let raw = r2Objects(ctx.env.BLOBS)
  let hashes = object(args.files)
  let source = await pins(raw, `${space.slug}/`).get(
    say(hashes['data/sfx/01.json']),
  )
  if (!source) throw refuse('missing', 'staged 01.json is missing')
  let definition = (JSON.parse(decode(source)) as Bundle[]).find((r) =>
    r.builder
  )
  if (!definition) throw refuse('arguments', 'shared builder is missing')
  let store = appStore(ctx.env.STORE, space, app)
  let [builders, builds, outputs, sounds, artifacts, allCites] =
    await Promise.all([
      read(store, '.builder&*'),
      read(store, '.build&*'),
      read(store, '.built&*'),
      read(store, '.sfx&*'),
      read(store, '.artifact&*'),
      read(store, '.cites&*'),
    ])
  let made = new Set(outputs.map((r) => r.entity.eid))
  let citations = allCites.filter((r) =>
    made.has(say((r.edge as { from?: string } | undefined)?.from))
  )
  let [tool] = await read(store, `.eid=${say((definition.builder as { to: string }).to)}&*`)
  if (!tool?.tool) throw refuse('missing', 'builder model tool is missing')
  let declared = await json(await store('/vocab', {}, { 'x-yak-kernel': '1' }))
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
  let change = migrate(
    { builders, builds, outputs, sounds, artifacts, citations },
    definition,
    plans,
  )
  if (args.check === true) {
    return {
      text: `ready: ${builders.length} legacy builders, ${builds.length} builds, ${outputs.length} outputs, ${citations.length} citations; ${change.length} bundles`,
      value: { bundles: change.length },
    }
  }
  await json(await store('/apply', {
    method: 'POST',
    body: JSON.stringify(change),
  }, { 'x-yak-kernel': '1' }))
  return {
    text: `migrated ${builders.length} Vale sound builders to one shared builder; kept ${outputs.length} artifact references and ${citations.length} citations`,
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
  if (!version.source.startsWith(`${space.slug}/.releases/${app.eid}/`)) {
    throw refuse('arguments', 'release source does not match its asset address')
  }
  let held = await indexOf(raw, version.source + '/')
  if (!held) throw refuse('arguments', 'release has no content index')
  if (
    Object.values(held).some((file) =>
      !file.sha || file.key != `sha/${file.sha}`
    )
  ) throw refuse('arguments', 'release index needs promotion before repackage')
  let audit = `${AUDIT}releases/${version.eid}.json`
  if (args.check === true) {
    return {
      text:
        `ready v${version.version}: ${plan.changed.length} source files; audit ${audit}`,
      value: { changed: plan.changed, audit },
    }
  }
  if (await raw.has(audit)) {
    throw refuse('conflict', `audit ${audit} already exists; inspect before retry`)
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
  let oldIndex = await raw.get(version.source + META)
  let revised = JSON.parse(decode(newIndex)) as typeof held
  for (let path of [...STAGED, 'vocab.json']) {
    if (files[path] != plan.files[path]) {
      throw new Error(`repackaged ${path} does not match its staged bytes`)
    }
  }
  let prior = releaseFiles(raw)
  for (let [path, file] of Object.entries(held)) {
    if (revised[path]?.sha == file.sha) continue
    let sha = file.sha!
    let backup = `${AUDIT}sha/${sha}`
    if (!await raw.has(backup)) {
      let bytes = await prior.get(`${version.source}/${path}`)
      if (await sha256(bytes) != sha) {
        throw new Error(`original ${path} does not match its index`)
      }
      await raw.put(backup, bytes)
    }
  }
  let proof = {
    at: new Date().toISOString(),
    deploy: version.eid,
    app: app.eid,
    version: version.version,
    source: version.source,
    before: { files: version.files, index: JSON.parse(decode(oldIndex)) },
    after: { files, index: JSON.parse(decode(newIndex)) },
  }
  await raw.put(audit, encode(JSON.stringify(proof)))
  await raw.put(version.source + META, newIndex)
  await ctx.dir.stamp({
    entities: [{ entity: { eid: version.eid }, deploy: { files: JSON.stringify(files) } }],
  })
  await purged(ctx.env, app)
  return {
    text: `repackaged v${version.version}; audit ${audit}; ${plan.changed.length} source files changed`,
    value: { audit, files },
  }
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
    throw refuse('arguments', `unknown Vale migration phase ${phase}`)
  },
}
