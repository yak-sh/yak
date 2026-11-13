/**
 * A round in a graph: found by the name it was loaded under, read whole for
 * the deck and the tally, loaded from its file and dropped. The rows
 * themselves are ./skill.ts's.
 *
 * @module
 */
import type { Actor, Bundle, Eid, Graph } from '@yaks/graph'
import { signed } from '@yaks/graph/provenance'
import { Refused } from '@yaks/graph/errors'
import { named, type RoundFile, rows } from './skill.ts'

let attempt = (b: Bundle) => (b.writing ?? {}) as Record<string, unknown>

/** The round a word names: the key it was loaded under (`copy-r1`), or any
 * id the graph resolves. */
export let find = async (g: Graph, word: string): Promise<Eid> => {
  // A word no plugin resolves is refused; it may still be an eid.
  let eid = await address(g, named.round(word)) ?? await address(g, word) ??
    word
  let [round] = await g.get([eid], ['round'])
  if (!round?.round) throw new Refused(`no round is named ${word}`)
  return round.entity.eid
}

/** Whether a row is still to be returned (./run.ts): an attempt a model is to
 * write that has no `output`, a guess with no `guesses`, or a judge's
 * comparison with neither a `chose` nor a `why`. */
export let unreturned = (b: Bundle): boolean => {
  let said = (b.guess ?? b.preference ?? {}) as Record<string, unknown>
  return b.writing
    ? !!attempt(b).variant && !attempt(b).output
    : b.preference
    ? !!said.judge && !said.chose && !said.why
    : !!b.guess && !said.guesses
}

/** Everything a round's deck and tally read: the round, its attempts, their
 * variants and cases, its pairs, each preference, mark and guess aimed at
 * one of its attempts, the judges those name, the skill it develops, and the
 * title of whoever set the round's passing share. An attempt or a guess still to be returned is
 * no attempt or guess yet, and is left out unless `planned` asks for them. */
export let gather = async (
  g: Graph,
  round: Eid,
  planned = false,
): Promise<Bundle[]> => {
  let r = JSON.stringify(round)
  let here = (b: Bundle) => planned || !unreturned(b)
  let attempts = (await g.read(`.writing .writing.round=${r} *`)).filter(here)
  let of = (prop: string) =>
    attempts.map((a) => attempt(a)[prop]).filter((e) => e).map(String)
  let [head, ...rest] = await Promise.all([
    g.get([round, ...new Set([...of('variant'), ...of('case')])]),
    g.read(`.pair .pair.round=${r} *`),
    g.read(`.preference .preference.first.writing.round=${r} *`),
    g.read(`.grabbed .grabbed.attempt.writing.round=${r} *`),
    g.read(`.guess .guess.attempt.writing.round=${r} *`),
  ])
  let aimed = rest.flat().filter(here)
  let named = (comp: string) =>
    aimed.map((b) => (b[comp] as { judge?: unknown })?.judge)
  let judges = [...new Set([...named('preference'), ...named('guess')])]
    .filter((e) => e).map(String)
  let by = (head[0]?.passing as { by?: unknown })?.by
  let skill = (head[0]?.round as { skill?: unknown })?.skill
  let more = await Promise.all([
    g.get(judges),
    by ? g.get([String(by)], ['doc']) : [],
    skill ? g.get([String(skill)], ['skill', 'doc']) : [],
  ])
  return [...head, ...more.flat()].filter((b) => b)
    .concat(attempts, aimed)
}

/** How a round's file named a variant or a case: the key it was loaded under
 * (`none`, `office-facts`), which is shorter than its title and is what the
 * next round's file will say. A row loaded under no name keeps its title. */
export let keyed = async (
  g: Graph,
  all: Bundle[],
): Promise<(b: Bundle) => string> => {
  let eid = (all.find((b) => b.round)?.round as { skill?: unknown })?.skill
  let skill = String(
    (all.find((b) => b.skill && b.entity.eid == eid)?.doc as {
      title?: unknown
    })?.title ?? '',
  )
  let keys = new Map<Eid, string>()
  await Promise.all(
    all.filter((b) => b.variant || b.case).map(async (b) => {
      let start = (b.variant ? named.variant : named.case)(skill, '')
      let names = await g.read(
        `.alias .key.of=${JSON.stringify(b.entity.eid)} .fields=key.value`,
      )
      let name = names.map((n) => String((n.key as { value?: unknown })?.value))
        .find((n) => n.startsWith(start))
      if (name) keys.set(b.entity.eid, name.slice(start.length))
    }),
  )
  return (b) =>
    keys.get(b.entity.eid) ?? String((b.doc as { title?: unknown })?.title)
}

// The eid a word names, or nothing where no plugin resolves it.
let address = async (g: Graph, word: string): Promise<Eid | undefined> => {
  try {
    return (await g.address([word])).get(word)
  } catch { /* not a name */ }
}

/** Gives the skill a round file names by its title a name to land on: a
 * skill kept under that title and never trialled yet is given the name
 * `skill:<title>`, so the round develops it rather than a new one. */
let titled = async (
  g: Graph,
  title: string,
  apply: (bundles: Bundle[]) => unknown,
) => {
  let name = named.skill(title)
  if (await address(g, name)) return
  let [kept] = await g.read(
    `.skill .doc.title=${JSON.stringify(title)} .limit=1 .fields=entity.eid`,
  )
  if (kept) await apply([{ entity: kept.entity, alias: { name } }])
}

/** Loads a round's file: every row written, and the round's pairs and guesses
 * the file no longer holds deleted, so loading again replaces what the first
 * load wrote. An attempt the file dropped is left, since a person's taps may
 * rest on it; `left` counts them. A skill the graph keeps under the file's
 * title is the one it develops. */
export let load = async (
  g: Graph,
  file: RoundFile,
  /** who the rows are written as, where not the graph's own writer */
  actor?: Actor,
): Promise<{ round: Eid; rows: number; removed: number; left: number }> => {
  let apply = (bundles: Bundle[]) =>
    g.apply(actor ? signed(bundles, actor) : bundles)
  let made = rows(file)
  await titled(g, file.skill, apply)
  let patches = await apply(made)
  let round = patches.find((p) => p.round)?.entity.eid ??
    await find(g, file.key)
  let now = new Set(made.map((b) => b.entity.eid))
  let stale = (await gather(g, round, true)).filter((b) =>
    !now.has(b.entity.eid) &&
    (b.pair || b.guess || attempt(b).variant ||
      (b.preference && unreturned(b)))
  )
  // An attempt nobody wrote has nothing resting on it, and goes with the plan.
  let gone = stale.filter((b) => !b.writing || unreturned(b))
  if (gone.length) {
    await apply(gone.map((b) => ({ entity: b.entity, $delete: true })))
  }
  return {
    round,
    rows: made.length,
    removed: gone.length,
    left: stale.length - gone.length,
  }
}

/** Deletes a round and what hangs from it (attempts, pairs, taps, guesses),
 * then each variant and case no other round's attempt names, and each judge
 * no verdict is left from. */
export let drop = async (g: Graph, round: Eid): Promise<number> => {
  let all = await gather(g, round, true)
  let shared = all.filter((b) => b.variant || b.case || b.judge)
  await g.apply([{ entity: { eid: round }, $delete: true }])
  let unused: Bundle[] = []
  for (let b of shared) {
    let eid = JSON.stringify(b.entity.eid)
    let names = b.judge
      ? [`.preference .preference.judge=${eid}`, `.guess .guess.judge=${eid}`]
      : [`.writing .writing.${b.variant ? 'variant' : 'case'}=${eid}`]
    let left = await Promise.all(names.map((q) => g.read(`${q} .limit=1`)))
    if (!left.flat().length) unused.push({ entity: b.entity, $delete: true })
  }
  if (unused.length) await g.apply(unused)
  return all.length
}
