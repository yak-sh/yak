// Discovery reads release metadata in R2, never the app's Durable Object.
// Deploy writes the accepted (including retained/borrowed words) declaration
// before its directory pointer commits, so every release a pointer selects has
// one.
import type { VocabDoc } from '@yaks/vocab'
import type { Tools } from '@yaks/tools/declared'
import { type App, releaseOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { r2RawObjects } from './lib/objects.ts'

export type Declaration = { vocab: VocabDoc; tools: Tools }
let key = (space: Space, app: App, release: string) =>
  `${space.store}/.declarations/${app.eid}/${
    app.source?.split('/').pop() ?? 'legacy'
  }/${release}.json`

// A declaration is written once, under a name no other write uses (a deploy's
// release and version, a rollback's or a home's own name), so what a key
// holds never changes and this isolate keeps the text it has read. Every MCP
// call composes the caller's vocabulary from the declarations of every app
// they reach (agent.ts `spoken`), and a bucket read is a fifth of a second
// (T-123988). The text, so each caller parses a value of its own; the newest
// HELD are kept.
let HELD = 256
let held = new Map<string, Promise<string>>()
let hold = (at: string, text: Promise<string>) => {
  held.delete(at)
  held.set(at, text)
  text.catch(() => held.get(at) == text && held.delete(at))
  for (let old of held.keys()) {
    if (held.size <= HELD) break
    held.delete(old)
  }
  return text
}

export let keepDeclaration = async (
  env: Env,
  space: Space,
  app: App,
  release: string,
  value: Declaration,
) => {
  let at = key(space, app, release)
  let text = JSON.stringify(value)
  await r2RawObjects(env.BLOBS).put(at, new TextEncoder().encode(text))
  hold(at, Promise.resolve(text))
}

export let declarationOf = (
  env: Env,
  space: Space,
  app: App,
): Promise<Declaration> => {
  let release = releaseOf(app)
  if (release == '0') return Promise.resolve({ vocab: {}, tools: {} })
  let at = key(space, app, release)
  return hold(
    at,
    held.get(at) ?? r2RawObjects(env.BLOBS).read(at).then((bytes) => {
      if (!bytes) {
        throw new Error(
          `${space.slug}/${app.slug} release ${release} has no declaration`,
        )
      }
      return new TextDecoder().decode(bytes)
    }),
  ).then((text): Declaration => JSON.parse(text))
}
