// A released draft's preview rows, merged into the live app's only when the
// release asks for them (D-453, step 4 of c8807d60). A draft's preview reads
// and writes the app's store on a branch of its own (preview.ts). A release
// is of the draft's code and copy: what the branch wrote since its fork stays
// there, out of the live rows, on a `draft_rows` row of the directory naming
// the branch and how many rows it holds (`draftKept`), until app_deploy with
// rows: all merges them or a discard drops them, so nothing written in a
// preview is lost and no row written to try a draft out lands in the people's
// own. A release with rows: all, or app_deploy naming the kept rows later,
// merges them into the live rows three ways per property (@yaks/journal
// `merge`, graph.ts `#merging`), as one batch written as whoever asked, and
// the branch is dropped (`draftReleased`).
//
// A property the preview and the live app both changed is the person's to
// settle: one decision each, in their Updates, showing its value when the
// draft began, the draft's and the live app's. Nothing merges while one is
// unanswered, so the branch stays. Once each is answered (the Operator
// store's `draft_merge` effect, `settled`) the merge runs with those picks.
// A pick names the live value it was made seeing: a person's write on the
// live app since is one they never chose over, so that property is asked
// about again rather than written over.
import { line } from '@yaks/query'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { Choice, Conflict } from '@yaks/journal'
import type { Door } from '@yaks/durable-object/door'
import {
  type App,
  appStore,
  type Directory,
  directoryOf,
  type Space,
} from './directory.ts'
import type { Env } from './env.ts'
import { builderOf, SPACE } from './build-door.ts'
import { instrumentEid } from '@yaks/platform/instrument'
import { acting, vouched, type Who } from './session.ts'
import type { AppDraft } from './written.ts'

/** Which rows a release merges (app_deploy `rows`): none, the default, or
 * all its draft's preview wrote. */
export type Rows = 'none' | 'all'

/** A released draft's preview rows kept on its branch (`draft_rows`). */
export type DraftRows = {
  eid: string
  /** the released draft's eid, which app_deploy and app_files name it by */
  draft: string
  branch: number
  version: number | null
  /** each an entity the preview changed */
  rows: number
  by: string | null
  at: string | null
}

/** A draft whose branch a merge takes: its eid, branch, and whose it is. */
export type Branched = Pick<AppDraft, 'eid' | 'by'> & { branch: number }

/** What a merge came to: the conflicts it left, and how many rows it wrote,
 * none while a conflict stands. */
export type Merging = { conflicts: Conflict[]; merged: number }

/** Who a merge is written as: the store's writer for the releasing caller
 * (app-authority.ts `signer`). */
export type Writer = { by?: string; via?: string }

/** The choices of a merge's question, by label. */
export let DRAFT = 'Keep the draft’s', LIVE = 'Keep the live app’s'

/**
 * Merge branch `branch` of the store behind `store` into its live rows with
 * `picks`, written as the caller `head` vouches for (session.ts `vouched`).
 */
export let mergeBranch = (
  store: Door,
  branch: number,
  head: Record<string, string>,
  picks: Choice[] = [],
): Promise<Merging> =>
  store.consume(
    `/branches/${branch}/merge`,
    async (res) => {
      if (!res.ok) throw new Error(`merge: ${res.status} ${await res.text()}`)
      return await res.json() as Merging
    },
    { method: 'POST', body: JSON.stringify({ picks }) },
    { ...head, 'x-yak-kernel': '1' },
  )

/** How many rows branch `branch` of the store behind `store` wrote since its
 * fork: each an entity it changed (graph.ts `#branching`, `changes`). */
export let rowsOn = (store: Door, branch: number): Promise<number> =>
  store.consume(
    `/branches/${branch}/changes`,
    async (res) => {
      if (!res.ok) {
        throw new Error(`changes: ${res.status} ${await res.text()}`)
      }
      let { changes } = await res.json() as { changes: { eid: string }[] }
      return new Set(changes.map((c) => c.eid)).size
    },
    {},
    { 'x-yak-kernel': '1' },
  )

/** Branch `branch` of the store behind `store` dropped, with everything
 * written on it; one already gone is no matter. */
export let dropBranch = (store: Door, branch: number): Promise<void> =>
  store.consume(
    `/branches/${branch}`,
    async (res) => {
      if (!res.ok && res.status != 404) {
        throw new Error(`drop branch: ${res.status} ${await res.text()}`)
      }
      await res.body?.cancel()
    },
    { method: 'DELETE' },
    { 'x-yak-kernel': '1' },
  )

/** The head a merge is written under, for a writer kept on its question. */
let headOf = (w: Writer): Record<string, string> => ({
  ...w.by ? { 'x-yak-person': w.by } : {},
  ...w.via ? { 'x-yak-via': w.via } : {},
})

/** A value as a question shows it: text in quotes, anything else as JSON,
 * nothing where a side holds none. */
let shown = (v: unknown) =>
  v == null ? 'nothing' : typeof v == 'string' ? `“${v}”` : JSON.stringify(v)

/** What a merge's conflicts ask, of whom, and about which release. */
export type Asking = {
  /** the person asked: whoever released the draft */
  to: string
  app: Pick<App, 'eid' | 'slug' | 'title'>
  draft: string
  branch: number
  writer: Writer
  conflicts: Conflict[]
}

/**
 * One decision per conflict, assigned to the person, for the space's
 * Operator store. Each is named for its property and the live value it
 * shows, so asking the same again asks nothing new, and a live value that
 * moved since asks again.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let [question] = asked({
 *   to: 'p', app: { eid: 'a', slug: 'cards', title: 'Cards' }, draft: 'd',
 *   branch: 2, writer: { by: 'p' },
 *   conflicts: [{ eid: 'e', comp: 'card', prop: 'name', fork: 'a', branch: 'b', main: 'c' }],
 * })
 * assertEquals((question.decision as { choices: { description: string }[] }).choices
 *   .map((c) => c.description), ['Set it to “b”.', 'Leave it as “c”.'])
 * ```
 */
export let asked = (
  { to, app, draft, branch, writer, conflicts }: Asking,
): Bundle[] =>
  conflicts.map((c) => {
    let live = JSON.stringify(c.main ?? null)
    let question = `A draft of ${app.title || app.slug} was released, and ` +
      `its preview and the live app both changed ${c.comp}.${c.prop} of ` +
      `${c.eid}, which was ${shown(c.fork)} when the draft began. Which ` +
      'should the live app keep? What else the preview wrote waits until ' +
      'you choose.'
    return {
      entity: {
        eid: derivedEid(
          `draft-conflict|${app.eid}|${branch}|${c.eid}|${c.comp}|${c.prop}|${live}`,
        ),
      },
      task: {},
      doc: { title: question },
      decision: {
        question,
        choices: [
          { label: DRAFT, description: `Set it to ${shown(c.branch)}.` },
          { label: LIVE, description: `Leave it as ${shown(c.main)}.` },
        ],
        recommended: LIVE,
      },
      filed: { assignee: to },
      draft_conflict: {
        app: app.eid,
        branch,
        draft,
        eid: c.eid,
        comp: c.comp,
        prop: c.prop,
        live,
        ...writer.by ? { by: writer.by } : {},
        ...writer.via ? { via: writer.via } : {},
      },
    }
  })

/**
 * The picks a merge's questions came to, `rows` being each of them: null
 * while one is unanswered. A cancelled question picks nothing. An answer
 * other than the draft's is the live app's, which loses nothing of it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let q = (choice?: string) => ({
 *   entity: { eid: 'q' },
 *   draft_conflict: { eid: 'e', comp: 'card', prop: 'name', live: '"c"' },
 *   ...choice ? { decided: { choice } } : {},
 * })
 * assertEquals(picksOf([q(DRAFT), q()]), null)
 * assertEquals(picksOf([q(DRAFT)]), [
 *   { eid: 'e', comp: 'card', prop: 'name', take: 'branch', main: 'c' },
 * ])
 * ```
 */
export let picksOf = (rows: Bundle[]): Choice[] | null => {
  let open = rows.filter((r) => !r.cancelled)
  if (open.some((r) => !r.decided)) return null
  return open.map((r) => {
    let c = r.draft_conflict as Comp
    return {
      eid: String(c.eid),
      comp: String(c.comp),
      prop: String(c.prop),
      take: (r.decided as Comp).choice == DRAFT ? 'branch' : 'main',
      main: JSON.parse(String(c.live ?? 'null')),
    }
  })
}

/** Ask a space's people a merge's questions, through its Operator's store
 * (build.ts `/operator/ask`). */
export let ask = async (
  env: Env,
  space: Pick<Space, 'eid'>,
  asking: Asking,
) => {
  let res = await builderOf(env, space.eid)(() =>
    new Request('https://builder/operator/ask', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-kernel': '1',
        [SPACE]: space.eid,
      },
      body: JSON.stringify(asking),
    })
  )
  if (!res.ok) throw new Error(`the Operator was not asked (${res.status})`)
  await res.body?.cancel()
}

/**
 * Draft `draft`'s branch merged into the app's live rows, right after a
 * release of it with rows: all went live (tools.ts `published`), or when
 * app_deploy names its kept rows (`keptMerged`), written as `who`'s act
 * (session.ts `acting`): with nothing in conflict it is in and the branch
 * gone; otherwise the person is asked about each conflict, and none being
 * there to ask, the branch waits.
 */
export let draftReleased = async (
  env: Env,
  space: Space,
  app: App,
  draft: Branched,
  caller: Who,
): Promise<Merging & { asked: string | null }> => {
  let { who } = acting(caller)
  let m = await mergeBranch(
    appStore(env.STORE, space, app, env),
    draft.branch,
    vouched(who),
  )
  let to = who.person ?? draft.by
  if (!m.conflicts.length || !to) return { ...m, asked: null }
  let by = who.actor ?? who.person
  await ask(env, space, {
    to,
    app,
    draft: draft.eid,
    branch: draft.branch,
    writer: {
      ...by ? { by } : {},
      ...who.via ? { via: instrumentEid(who.via) } : {},
    },
    conflicts: m.conflicts,
  })
  return { ...m, asked: to }
}

/**
 * Draft `draft`'s branch kept out of the live rows by a release of it as
 * `version` that did not ask for them: its row (`draft_rows`) names the
 * branch and how many rows the preview wrote there. A branch that wrote
 * nothing is dropped, and nothing is kept. Answers that count.
 */
export let draftKept = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  draft: Branched,
  version: number,
  caller: Who,
): Promise<number> => {
  let store = appStore(env.STORE, space, app, env)
  let rows = await rowsOn(store, draft.branch)
  if (!rows) {
    await dropBranch(store, draft.branch)
    return 0
  }
  await dir.stamp({
    entities: [{
      entity: { eid: derivedEid(`draft_rows|${app.eid}|${draft.eid}`) },
      draft_rows: {
        app: app.eid,
        draft: draft.eid,
        branch: draft.branch,
        version,
        rows,
        ...draft.by ? { by: draft.by } : {},
        at: new Date().toISOString(),
      },
    }],
  }, vouched(caller))
  return rows
}

/** Kept rows `kept` let go of: their row deleted, so app_deploy and a
 * discard no longer find them. */
let unkept = (dir: Directory, kept: DraftRows, caller: Who) =>
  dir.stamp(
    { entities: [{ entity: { eid: kept.eid }, $delete: true }] },
    vouched(caller),
  )

/** A released draft's kept rows merged into the live app (app_deploy
 * rows: all naming the draft), as `draftReleased` merges at a release: a
 * property both changed waits for the person's pick, and the row goes either
 * way, the branch being the questions' to settle from then. */
export let keptMerged = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  kept: DraftRows,
  caller: Who,
) => {
  let m = await draftReleased(env, space, app, {
    eid: kept.draft,
    by: kept.by,
    branch: kept.branch,
  }, caller)
  await unkept(dir, kept, caller)
  return m
}

/** A released draft's kept rows discarded (app_files op: discard naming the
 * draft): the branch dropped with everything on it, and the row. */
export let keptDiscarded = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  kept: DraftRows,
  caller: Who,
) => {
  await dropBranch(appStore(env.STORE, space, app, env), kept.branch)
  await unkept(dir, kept, caller)
}

/**
 * The Operator store's `draft_merge` effect: question `eid` was answered.
 * Once every question of its merge is, the merge runs with their picks, and
 * whatever the live app changed since they were asked is asked again.
 */
export let settled = async (env: Env, g: Graph, eid: string) => {
  let [row] = await g.get([eid])
  let c = row?.draft_conflict as Comp | undefined
  if (!c || !row.decided) return
  let rows = await g.read(
    line`.draft_conflict.app=${String(c.app)} .draft_conflict.branch=${
      String(c.branch)
    } ?decided ?cancelled`,
  )
  let picks = picksOf(rows)
  if (!picks) return
  let found = await directoryOf(env.STORE).appAt(String(c.app))
  if (!found) return
  let writer: Writer = {
    ...c.by ? { by: String(c.by) } : {},
    ...c.via ? { via: String(c.via) } : {},
  }
  let branch = Number(c.branch)
  let m = await mergeBranch(
    appStore(env.STORE, found.space, found.app, env),
    branch,
    headOf(writer),
    picks,
  )
  let to = String((row.filed as Comp | undefined)?.assignee ?? '')
  if (m.conflicts.length && to) {
    await g.apply(
      asked({
        to,
        app: found.app,
        draft: String(c.draft),
        branch,
        writer,
        conflicts: m.conflicts,
      }),
      { trusted: true },
    )
  }
}
