// Discovery reads release metadata in R2, never the app's Durable Object.
// Deploy writes the accepted (including retained/borrowed words) declaration
// before its directory pointer commits, so every release a pointer selects has
// one.
import type { VocabDoc } from '@yaks/vocab'
import type { Tools } from '@yaks/tools/declared'
import { CallError } from '@yaks/tools/errors'
import { type App, releaseOf, type Space, storeName } from './directory.ts'
import type { Env } from './env.ts'
import { r2RawObjects } from './lib/objects.ts'
import { recall } from './lib/hops.ts'

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

export let declarationOf = (
  env: Env,
  space: Space,
  app: App,
): Promise<Declaration> => {
  let release = releaseOf(app)
  if (release == '0') return Promise.resolve({ vocab: {}, tools: {} })
  return recall(storeName(space, app), `declaration:${release}`, async () => {
    let bytes = await r2RawObjects(env.BLOBS).read(key(space, app, release))
    if (!bytes) {
      throw new Error(
        `${space.slug}/${app.slug} release ${release} has no declaration`,
      )
    }
    return JSON.parse(new TextDecoder().decode(bytes))
  }).catch((error) => {
    // Accepted release metadata is not a caller's proposed write, and a
    // selected release without it is our defect too. A refusal while reading
    // it is not a 4xx to suppress at the router; preserve the cause and let
    // the kernel report it to the tracker.
    if (error instanceof CallError) {
      throw new Error(`Release discovery failed: ${error.message}`, {
        cause: error,
      })
    }
    throw error
  })
}
