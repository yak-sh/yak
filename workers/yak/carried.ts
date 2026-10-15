// The shapes an app's files had before T-124791, carried into `written` rows
// (written.ts) once. A draft kept its own bytes under
// `<space>/.drafts/<app eid>/delta-v<n>-<uuid>/<path>`, with an empty
// `.deleted/<path>` for each deletion, and `app.draft` named that prefix. A
// path's history was a JSON log at `<space>/<app>/history/<path>.json`, newest
// first, each entry the bytes a write replaced and that write's time and
// author.
//
// Both ride the daily sweep (erase.ts `collected`) until none is left, and an
// old draft also moves the moment anything reads it (written.ts `drafting`).
// Each step can run twice: rows go in under eids derived from what they say,
// the old keys go only once their rows have landed, and bytes not yet at their
// content address are put there before a row names them.
import type { Objects } from '@yaks/blob'
import { lanes } from '@yaks/fp'
import { derivedEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import type { App, Directory } from './directory.ts'
import {
  addressed,
  type Files,
  LANES,
  own,
  pinned,
  sha256,
} from './versions.ts'
import { caught } from './defects.ts'
import { filesOf, prepare } from './release.ts'

/** Whether an app's draft is still the old kind: a prefix of its own bytes. */
export let old = (app: App) => !!app.draft?.includes('/.drafts/')

// A row as the directory takes it, under an eid derived from what it says.
let row = (
  app: App,
  w: {
    draft?: string
    path: string
    sha?: string | null
    was?: string | null
    size?: number | null
    at?: string | null
    by?: string | null
  },
) => ({
  entity: {
    eid: derivedEid(
      `written|${app.eid}|${w.draft ?? ''}|${w.path}|${w.at ?? ''}|${
        w.sha ?? ''
      }`,
    ),
  },
  written: {
    app: app.eid,
    path: w.path,
    ...w.draft ? { draft: w.draft } : {},
    ...w.sha ? { sha: w.sha } : {},
    ...w.was ? { was: w.was } : {},
    ...w.size != null ? { size: w.size } : {},
    ...w.at ? { at: w.at } : {},
    ...w.by ? { by: w.by } : {},
  },
})

// A directory batch of rows, a few hundred at a time.
let stamped = async (dir: Directory, bundles: object[]) => {
  for (let at = 0; at < bundles.length; at += 200) {
    await dir.stamp({ entities: bundles.slice(at, at + 200) } as never)
  }
}

/**
 * An app's old draft as `written` rows: each file its bytes, put at their
 * address when they are not there yet, each deletion marker a delete, each
 * over what the serving release holds at the path, all written at the moment
 * the bucket says the key landed, under a draft id derived from the old
 * prefix, and `app.draft` moved to it under a guard. The old keys go last.
 * Answers the app as it now stands.
 */
export let adopted = async (
  raw: Objects,
  dir: Directory,
  app: App,
): Promise<App> => {
  if (!old(app)) return app
  let prefix = `${app.draft}/`
  let landed = await raw.uploaded(prefix)
  let at = (key: string) => new Date(landed[key]).toISOString()
  let keys = Object.keys(landed)
  let paths = new Set(
    own(keys.map((key) => key.slice(prefix.length))).filter((path) =>
      !path.startsWith('.deleted/')
    ),
  )
  let draft = derivedEid(`draft|${app.draft}`)
  let base = app.source ? filesOf(await prepare(raw, app.source)) : {}
  let rows: object[] = []
  await lanes(LANES)([...paths], async (path) => {
    let bytes = await raw.get(prefix + path)
    let sha = await sha256(bytes)
    if (!(await raw.has(addressed(sha)))) await raw.put(addressed(sha), bytes)
    rows.push(row(app, {
      draft,
      path,
      sha,
      was: base[path],
      size: bytes.byteLength,
      at: at(prefix + path),
    }))
  })
  for (let key of keys) {
    let path = key.slice(prefix.length)
    if (!path.startsWith('.deleted/') || paths.has(path.slice(9))) continue
    let gone = path.slice(9)
    rows.push(row(app, { draft, path: gone, was: base[gone], at: at(key) }))
  }
  // The rows first and the pointer with the last of them: rows nothing points
  // at yet are harmless, and a run cut off before the pointer moved adopts
  // the same rows again.
  await stamped(dir, [...rows, {
    entity: { eid: app.eid },
    app: { draft },
    $was: { app: { draft: token(app.draft ?? null) } },
  }])
  await raw.delete(keys)
  return { ...app, draft }
}

/**
 * The paths an app still in an old shape holds, read off its keys rather
 * than carried into rows: what an erasure counts before everything goes. Null
 * for an app already in the new shape. `base` is the serving release's paths.
 */
export let oldPaths = async (
  raw: Objects,
  prefix: string,
  app: App,
  base: string[],
): Promise<string[] | null> => {
  let legacy = !app.source && !!app.version
  if (!legacy && !old(app)) return null
  let keys = async (at: string) =>
    (await raw.list(at)).map((key) => key.slice(at.length))
  let paths = new Set(legacy ? own(await keys(prefix)) : base)
  if (old(app)) {
    for (let path of await keys(`${app.draft}/`)) {
      if (path.startsWith('.deleted/')) paths.delete(path.slice(9))
      else paths.add(path)
    }
  }
  return own([...paths])
}

/** One old history log's entries, newest first; none for a log that cannot
 * be read, which the tracker hears about. */
export let entries = async (raw: Objects, key: string) => {
  let bytes = await raw.read(key)
  if (!bytes) return []
  try {
    let held = JSON.parse(new TextDecoder().decode(bytes))
    return (Array.isArray(held) ? held : []) as {
      sha: string
      size: number
      at: string
      by: string
    }[]
  } catch (e) {
    caught(e, { request: 'version log' })
    return []
  }
}

/**
 * An app's old history logs as `written` rows, at most `budget` logs a run.
 * An entry said the bytes a write replaced, and when and by whom, so each
 * becomes that write's row, replacing them; what the write left is what the
 * next newer write replaced, and for the newest, what the oldest write since
 * replaced, or what the path holds now (`files`, asked only of an app with
 * logs). Bytes an entry names that are not at their address yet are carried
 * there from the app's old per-app key, using `have` (the shas the bucket
 * holds) to ask about each one only once. Answers how many logs it carried.
 */
export let histories = async (
  raw: Objects,
  dir: Directory,
  prefix: string,
  app: App,
  files: () => Promise<Files>,
  have: Set<string>,
  budget: number,
): Promise<number> => {
  let at = `${prefix}history/`
  let logs = (await raw.list(at)).filter((key) => key.endsWith('.json'))
    .slice(0, budget)
  if (!logs.length) return 0
  let now = await files()
  // The oldest write each path has had since the logs stopped: a write
  // always belongs to a draft, and a row carried here to none.
  let since = new Map<string, { at: string | null; was: string | null }>()
  for (let w of await dir.written(app)) {
    if (!w.draft) continue
    let had = since.get(w.path)
    if (!had || (w.at ?? '') < (had.at ?? '')) since.set(w.path, w)
  }
  let rows: object[] = []
  await lanes(LANES)(logs, async (key) => {
    let path = key.slice(at.length, -'.json'.length)
    let all = await entries(raw, key)
    for (let e of all) {
      if (have.has(e.sha)) continue
      let bytes = await raw.read(pinned(prefix, e.sha))
      if (bytes && await sha256(bytes) == e.sha) {
        await raw.put(addressed(e.sha), bytes)
        have.add(e.sha)
      }
    }
    all.forEach((e, i) =>
      rows.push(row(app, {
        path,
        sha: i
          ? all[i - 1].sha
          : since.has(path)
          ? since.get(path)!.was
          : now[path] ?? null,
        was: e.sha,
        size: i ? all[i - 1].size : null,
        at: e.at,
        by: e.by || null,
      }))
    )
  })
  await stamped(dir, rows)
  await raw.delete(logs)
  return logs.length
}
