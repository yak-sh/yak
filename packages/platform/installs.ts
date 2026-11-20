/**
 * `@yaks/platform/installs` — a published app installed into somebody's space:
 * a copy of its own, with its own row, its own store and its own data, pinned
 * to the version it took ({@link pinned}). What it copies is the publication's
 * files and their build, named by their shas, so an install copies no bytes
 * ({@link taken}, {@link copying}); it lands at the published app's own slug
 * where that is free ({@link landing}), and an update moves its pin to what
 * its publisher offers now ({@link reloads}).
 *
 * The space is the trust boundary (C-37980): a copy of a release the space
 * has reason to trust runs like the space's own apps ({@link vetted}). Any
 * other is born in the sandbox (D-37901, T-1857), and its space's owner may
 * let it out, or put any copy in, one install at a time ({@link sandboxing}).
 * A sandboxed app is served the way a phone serves a third-party app, in an
 * opaque origin of its own:
 *
 *  - The wall: every answer the app gives carries `Content-Security-Policy:
 *    sandbox …` without `allow-same-origin` ({@link walled}), so the browser
 *    runs its page in an origin nobody shares — no cookie, no storage, no
 *    reading its siblings — and `Referrer-Policy: no-referrer`, so the
 *    address below never leaves in a header.
 *  - The page token: the cookie authenticates the page load and nothing after
 *    it. The page is handed a token sealed for this app's store and this
 *    person, in its `<base href>` as `/<app>/~<token>/` ({@link tokenOf}), or
 *    as a bearer ({@link bearerOf}). The host seals and opens it.
 *  - Storage: an opaque origin has no localStorage, so the page is given one,
 *    its keys woven into the page beside the token ({@link stored}).
 *
 * ```ts
 * import { walled } from '@yaks/platform/installs'
 * import { assertEquals } from '@std/assert'
 * let res = walled(new Response('hi'))
 * assertEquals(res.headers.get('referrer-policy'), 'no-referrer')
 * ```
 *
 * @module
 */
import type { Reload } from './release.ts'
import { BUILT, type Files, own, type Version } from './versions.ts'

// ── What an install takes ────────────────────────────────────────────────

/** Whether a published version's path travels with an install: a file
 * somebody wrote, or the build made from them. */
export let transferable = (path: string) =>
  !!own([path]).length || path.startsWith(BUILT)

/** What of a published version's files an install takes. */
export let taken = (files: Files): Files =>
  Object.fromEntries(
    Object.entries(files).filter(([path]) => transferable(path)),
  )

/** The changes that make a copy's draft, holding `had`, the publication
 * `from`: each of its files at its sha, and each the copy took before that it
 * no longer has gone. `wrote` and `gone` are the files somebody wrote. */
export let copying = (from: Files, had: Files) => {
  let gone = Object.keys(had).filter((path) =>
    transferable(path) && !(path in from)
  )
  return {
    changes: [
      ...Object.entries(from).map(([path, sha]) => ({ path, sha })),
      ...gone.map((path) => ({ path })),
    ],
    wrote: own(Object.keys(from)),
    gone: own(gone),
  }
}

/**
 * The slug a copy lands at: `as` where the installer said one, else the
 * published app's own `slug` where it is `vacant` in the space, else its
 * published `name`, numbered `-2`, `-3`, … until one is. An app is written at
 * its own address — a page that names `/chores/api/client.js`, an app that
 * reaches a sibling by name — so a copy landing at another is renamed out
 * from under its own files (C-32905 items 1 and 3).
 */
export let landing = async (
  slug: string,
  name: string,
  vacant: (slug: string) => Promise<boolean>,
  as: string | null = null,
): Promise<string> => {
  if (as != null) return as
  if (await vacant(slug)) return slug
  let s = name
  for (let n = 2; !(await vacant(s)); n++) {
    let suffix = `-${n}`
    s = name.slice(0, 63 - suffix.length) + suffix
  }
  return s
}

/** What an install writes on its copy's row beside the row a new app is born
 * with: the pin naming the app it came from and the version it took, in the
 * sandbox or out of it (`walled`), and, where it takes over a stranger's
 * store (`visit`), that the store was seeded already, at the version its
 * sample was made at. */
export let pinned = (
  of: string,
  version: number,
  walled: boolean,
  visit: { seeded: number | null } | null = null,
  now = new Date(),
) => ({
  installed: { of, version, ...sandboxing(walled, now.toISOString()) },
  ...visit
    ? { seeded: { at: now.toISOString(), version: visit.seeded ?? version } }
    : {},
})

/**
 * Whether a copy of a release may run out of the sandbox in a space
 * (T-1857). Jeff, 2026-11-20: "Gallery apps are assumed safe since we do a
 * code review", "Any reviewed app could be unsandboxed, however it's
 * installed", "Or if the app author is in the space it's being installed
 * into". So: the release passed code review, or the space knows who made it,
 * because it is `kin` (the space the release was made in, or one of the
 * platform's own) or `author` (the person who made it, an agent's for whom it
 * writes) is among its `members`. Membership is read at each install and
 * update, so an author who leaves holds back only the next update.
 *
 * ```ts
 * import { vetted } from '@yaks/platform/installs'
 * import { assertEquals } from '@std/assert'
 * let at = { kin: false, members: new Set(['ann']) }
 * assertEquals(vetted({ reviewed: false, author: 'bob' }, at), false)
 * assertEquals(vetted({ reviewed: true, author: 'bob' }, at), true)
 * assertEquals(vetted({ reviewed: false, author: 'ann' }, at), true)
 * ```
 */
export let vetted = (
  release: { reviewed?: boolean; author?: string | null },
  at: { kin: boolean; members: ReadonlySet<string> },
) =>
  !!release.reviewed || at.kin ||
  (!!release.author && at.members.has(release.author))

/** The version an update moves a copy at `was` to, where its publisher
 * offers `to`: `to` itself in the sandbox (`walled`), else the newest of
 * their releases after `was` and up to `to` that `ok` vets (`to` alone where
 * the offer went back), or null where none does and the copy waits. */
export let next = <V extends Pick<Version, 'version'>>(
  theirs: V[],
  was: number,
  to: number,
  walled: boolean,
  ok: (release: V) => boolean,
): number | null =>
  walled ? to : theirs
    .filter((v) =>
      (to <= was ? v.version == to : v.version > was && v.version <= to) &&
      ok(v)
    )
    .reduce<number | null>((n, v) => Math.max(n ?? 0, v.version), null)

/** Whether moving a copy from version `was` to `to` of its publisher's
 * releases (`theirs`) needs its open pages reloaded: going back, or crossing a
 * release that said so. */
export let reloads = (
  theirs: Pick<Version, 'version' | 'reload'>[],
  was: number,
  to: number,
): Reload | undefined =>
  to < was ||
    theirs.some((v) =>
      v.version > was && v.version <= to && v.reload == 'required'
    )
    ? 'required'
    : undefined

/** Whether anyone may have the files of the release the app offers: a
 * published app's, which installing hands to whoever asks, private or not.
 * Its other releases, and its data, stay its own people's. */
export let offered = (app: { published?: unknown }): boolean => !!app.published

// ── The sandbox ──────────────────────────────────────────────────────────

/** Whether this app runs walled off from its space: a copy its space's owner
 * sandboxed. */
export let sandboxed = (
  app: { installed?: { sandboxed?: string | null } | null },
) => !!app.installed?.sandboxed

/** What a copy's pin is written with to put it in the sandbox or let it
 * out. `trusted` is the build before this one's name for the reverse,
 * kept in step so that build serves every copy as this one does, until a
 * later release drops it (D-37972, expand then contract). */
export let sandboxing = (on: boolean, at = new Date().toISOString()) => ({
  sandboxed: on ? at : null,
  trusted: on ? null : at,
})

// The wall itself. Scripts, forms and popups are what an app is; the one
// flag that would undo the rest, `allow-same-origin`, is never here.
export let SANDBOX = 'sandbox allow-scripts allow-forms allow-popups'

/** An answer from a sandboxed app, walled: the sandbox, and no referrer, so
 * the token in the page's own addresses is never sent anywhere else.
 * Appended, so an app worker's own policy stacks with it rather than
 * replacing it. A socket has no headers to add. */
export let walled = (res: Response) => {
  if (res.status == 101) return res
  let headers = new Headers(res.headers)
  headers.append('content-security-policy', SANDBOX)
  headers.set('referrer-policy', 'no-referrer')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

/** The token segment leading an app-relative path, and the path after it.
 * `/~abc/api/query` is `{token: 'abc', rest: '/api/query'}`. */
export let tokenOf = (path: string) => {
  let hit = /^\/~([^/]+)(\/.*)?$/.exec(path)
  return hit ? { token: hit[1], rest: hit[2] ?? '/' } : null
}

/** The other way to hand one over: `Authorization: Bearer <token>`. */
export let bearerOf = (req: Request) =>
  /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ??
    null

/** The tags a sandboxed page is given for storage: the person's saved keys
 * as an inert JSON block, then the classic script that reads it, ahead of
 * every script of the page's own so `localStorage` is there before they run.
 * `<` is escaped, so no saved value can close the block. */
export let stored = (
  at: string,
  keys: Record<string, string>,
  saves: boolean,
) =>
  '<script type="application/json" id="yak-storage">' +
  JSON.stringify({ saves, keys }).replaceAll('<', '\\u003c') +
  `</script><script src="${at}api/storage.js"></script>`
