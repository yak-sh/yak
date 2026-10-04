// Discovery reads release metadata in R2, never the app's Durable Object.
// Deploy writes the accepted (including retained/borrowed words) declaration
// before its directory pointer commits. Old releases are read from their
// pinned files without waking a store or backfilling production.
import type { VocabDoc } from '@yaks/vocab'
import type { Tools } from '@yaks/tools/declared'
import { read } from '@yaks/yaml'
import {
  type App,
  directory,
  fetch as directoryFetch,
  releaseOf,
  type Space,
  storeName,
} from './directory.ts'
import { bound, type Env } from './env.ts'
import { r2Objects, r2RawObjects } from './lib/objects.ts'
import { recall } from './lib/hops.ts'
import { pins } from './versions.ts'
import { appDoc, coreDocs, grew, homed, type Homes } from './vocab.ts'
import { appTools, readTools } from './tool-grammar.ts'
import { documented, respelled, unholed, unworded } from './migrate.ts'
import { withKinds } from './kinds.ts'
import { componentsOf } from './vocab.ts'

export type Declaration = { vocab: VocabDoc; tools: Tools }
let key = (space: Space, app: App, release: string) =>
  `${space.slug}/.declarations/${app.eid}/${
    app.source?.split('/').pop() ?? 'legacy'
  }/${release}.json`

export let keepDeclaration = async (
  env: Env,
  space: Space,
  app: App,
  release: string,
  value: Declaration,
) => {
  await r2RawObjects(env.BLOBS).put(
    key(space, app, release),
    new TextEncoder().encode(JSON.stringify(value)),
  )
}

// Older releases have no accepted snapshot. Their immutable deploy files are
// still available. Preserve retired words conservatively (only the Store can
// know whether their columns are empty), and reconstruct homes in app order.
let legacy = async (env: Env, space: Space, app: App): Promise<Declaration> => {
  let dir = directory(bound(env.DIRECTORY, directoryFetch, env))
  let blobs = r2Objects(env.BLOBS)

  // Share the legacy reconstruction across all declarations of this space in
  // one request. Without this, N existing apps would read N deployment sets.
  let manifests = await recall(
    `directory:${space.eid}`,
    'legacy-declarations',
    async () => {
      let apps = (await dir.apps(space)).filter((a) => !a.trashed)
      if (!apps.some((a) => a.eid == app.eid)) apps.push(app)
      return await Promise.all(apps.map(async (one) => {
        let all = (await dir.deploys(one)).filter((v) =>
          v.version <= (one.version ?? 0)
        )
          .sort((a, b) => a.version - b.version)
        let retained: VocabDoc = {}, source: unknown = {}
        let oldTools: Tools | undefined
        let pin = pins(blobs, `${space.slug}/${one.slug}/`)
        for (let version of all) {
          let file = ['vocab.yml', 'vocab.json'].find((f) => version.files[f])
          if (!file) {
            source = {}
            continue
          }
          let bytes = await pin.get(version.files[file])
          if (!bytes) {
            throw new Error(`release has no vocabulary bytes for ${one.slug}`)
          }
          source = read(new TextDecoder().decode(bytes), file)
          let said = JSON.stringify(source)
          source = JSON.parse(documented(said) ?? said)
          retained = grew(retained, appDoc(source)).doc
          // Commands had their own file before they were entries of vocab.json.
          // Read that release's bytes and the same translations its Store applies.
          let commands = ['tools.yml', 'tools.json'].find((f) =>
            version.files[f]
          )
          if (commands && version.version == one.version) {
            let bytes = await pin.get(version.files[commands])
            if (!bytes) {
              throw new Error(`release has no command bytes for ${one.slug}`)
            }
            let said = JSON.stringify(
              read(new TextDecoder().decode(bytes), commands),
            )
            for (let translate of [unholed, unworded, respelled]) {
              said = translate(said) ?? said
            }
            oldTools = readTools(said)
          }
        }
        let bytes = await r2RawObjects(env.BLOBS).read(
          key(space, one, releaseOf(one)),
        )
        let snapshot: Declaration | undefined = bytes &&
          JSON.parse(new TextDecoder().decode(bytes))
        return {
          app: one,
          vocab: snapshot?.vocab ?? retained,
          source,
          tools: snapshot?.tools ?? oldTools,
          snapshot: !!snapshot,
        }
      }))
    },
  )
  let homes: Homes = {},
    vocab: VocabDoc = {},
    manifest: VocabDoc = {},
    source: unknown = {},
    tools: Tools | undefined
  for (let one of manifests) {
    // Installed sandboxes neither borrow nor home words for their space.
    let isolated = !!one.app.installed?.sandboxed
    let split = one.snapshot
      ? { mine: one.vocab, grows: {} }
      : homed(one.vocab, isolated ? {} : homes)
    if (one.app.eid == app.eid) {
      vocab = split.mine
      manifest = appDoc(one.source)
      source = one.source
      tools = one.tools
    }
    if (!isolated) {
      for (let [name, schema] of Object.entries(split.mine.$defs ?? {})) {
        homes[name] = { at: one.app.slug, props: schema.properties ?? {} }
      }
      for (let [slug, kinds] of Object.entries(split.grows)) {
        if (slug != app.slug) continue
        for (let [name, props] of Object.entries(kinds)) {
          let def = vocab.$defs?.[name]
          if (def) def.properties = { ...def.properties, ...props }
        }
      }
    }
  }
  let words = [
    ...componentsOf(coreDocs),
    ...Object.keys(homes),
    ...componentsOf([vocab]),
    ...componentsOf([manifest]),
  ]
  return {
    vocab,
    tools: tools ?? withKinds(
      appTools(source, words),
      manifest,
      `${space.slug}/${app.slug}`,
    ),
  }
}

export let declarationOf = (
  env: Env,
  space: Space,
  app: App,
): Promise<Declaration> => {
  let release = releaseOf(app)
  if (release == '0') return Promise.resolve({ vocab: {}, tools: {} })
  return recall(storeName(space, app), `declaration:${release}`, async () => {
    let bytes = await r2RawObjects(env.BLOBS).read(key(space, app, release))
    return bytes
      ? JSON.parse(new TextDecoder().decode(bytes))
      : legacy(env, space, app)
  })
}
