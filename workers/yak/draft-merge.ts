// A released draft's preview rows merged into the live app's (D-453, step 4
// of c8807d60). A draft's preview reads and writes the app's store on a
// branch of its own (preview.ts); once a release of that draft is live, what
// the branch wrote since its fork merges into the live rows three ways per
// property (@yaks/journal `merge`, graph.ts `#merging`), as one batch written
// as whoever released it, and the branch is dropped.
//
// A property the preview and the live app both changed is the person's to
// settle: one decision each, in their Updates, showing its value when the
// draft began, the draft's and the live app's. Nothing merges while one is
// unanswered, so the branch stays. Once each is answered (the Operator
// store's `draft_merge` effect, `settled`) the merge runs with those picks.
// A pick names the live value it was made seeing: a person's write on the
// live app since is one they never chose over, so that property is asked
// about again rather than written over.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { Choice, Conflict } from '@yaks/journal'
import type { Door } from '@yaks/durable-object/door'
import { type App, appStore, directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { builderOf, SPACE } from './build-door.ts'
import { instrumentEid } from './instrument.ts'
import { acting, vouched, type Who } from './session.ts'
import type { AppDraft } from './written.ts'

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
 * release of it went live (tools.ts `published`), written as `who`'s act
 * (session.ts `acting`): with nothing in conflict it is in and the branch
 * gone; otherwise the person is asked about each conflict, and none being
 * there to ask, the branch waits.
 */
export let draftReleased = async (
  env: Env,
  space: Space,
  app: App,
  draft: AppDraft & { branch: number },
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
 * The Operator store's `draft_merge` effect: question `eid` was answered.
 * Once every question of its merge is, the merge runs with their picks, and
 * whatever the live app changed since they were asked is asked again.
 */
export let settled = async (env: Env, g: Graph, eid: string) => {
  let [row] = await g.get([eid])
  let c = row?.draft_conflict as Comp | undefined
  if (!c || !row.decided) return
  let rows = await g.read(
    `.draft_conflict.app=${c.app} .draft_conflict.branch=${c.branch} ` +
      '?decided ?cancelled',
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
