/**
 * A round in a graph: found by the name it was loaded under, read whole for
 * the deck and the tally, loaded from its file and dropped. The rows
 * themselves are ./skill.ts's.
 *
 * @module
 */
import type { Bundle, Eid, Graph } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { named, type RoundFile, rows } from './skill.ts'

let attempt = (b: Bundle) => (b.writing ?? {}) as Record<string, unknown>

/** The round a word names: the key it was loaded under (`copy-r1`), or any
 * id the graph resolves. */
export let find = async (g: Graph, word: string): Promise<Eid> => {
  let names = [named.round(word), word]
  let found = new Map<string, Eid>()
  for (let name of names) {
    // A word no plugin resolves is refused; it may still be an eid.
    try {
      let eid = (await g.address([name])).get(name)
      if (eid) found.set(name, eid)
    } catch { /* not a name */ }
  }
  let eid = names.map((n) => found.get(n)).find((e) => e) ?? word
  let [round] = await g.get([eid], ['round'])
  if (!round?.round) throw new Refused(`no round is named ${word}`)
  return round.entity.eid
}

/** Everything a round's deck and tally read: the round, its attempts, their
 * variants and cases, its pairs, and each preference, mark and guess aimed
 * at one of its attempts. */
export let gather = async (g: Graph, round: Eid): Promise<Bundle[]> => {
  let r = JSON.stringify(round)
  let attempts = await g.read(`.writing .writing.round=${r} *`)
  let of = (prop: string) =>
    attempts.map((a) => attempt(a)[prop]).filter((e) => e).map(String)
  let [head, ...rest] = await Promise.all([
    g.get([round, ...new Set([...of('variant'), ...of('case')])]),
    g.read(`.pair .pair.round=${r} *`),
    g.read(`.preference .preference.first.writing.round=${r} *`),
    g.read(`.grabbed .grabbed.attempt.writing.round=${r} *`),
    g.read(`.guess .guess.attempt.writing.round=${r} *`),
  ])
  return [...head.filter((b) => b), ...attempts, ...rest.flat()]
}

/** How a round's file named a variant or a case: the key it was loaded under
 * (`none`, `office-facts`), which is shorter than its title and is what the
 * next round's file will say. A row loaded under no name keeps its title. */
export let keyed = async (
  g: Graph,
  all: Bundle[],
): Promise<(b: Bundle) => string> => {
  let skill = String(
    (all.find((b) => b.round)?.round as { skill?: unknown })?.skill ?? '',
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

/** Loads a round's file: every row written, and the round's pairs and guesses
 * the file no longer holds deleted, so loading again replaces what the first
 * load wrote. An attempt the file dropped is left, since a person's taps may
 * rest on it; `left` counts them. */
export let load = async (
  g: Graph,
  file: RoundFile,
): Promise<{ round: Eid; rows: number; removed: number; left: number }> => {
  let made = rows(file)
  let patches = await g.apply(made)
  let round = patches.find((p) => p.round)?.entity.eid ??
    await find(g, file.key)
  let now = new Set(made.map((b) => b.entity.eid))
  let stale = (await gather(g, round)).filter((b) =>
    !now.has(b.entity.eid) && (b.pair || b.guess || attempt(b).variant)
  )
  let gone = stale.filter((b) => !b.writing)
  if (gone.length) {
    await g.apply(gone.map((b) => ({ entity: b.entity, $delete: true })))
  }
  return {
    round,
    rows: made.length,
    removed: gone.length,
    left: stale.length - gone.length,
  }
}

/** Deletes a round and what hangs from it (attempts, pairs, taps, guesses),
 * then each variant and case no other round's attempt names. */
export let drop = async (g: Graph, round: Eid): Promise<number> => {
  let all = await gather(g, round)
  let shared = all.filter((b) => b.variant || b.case)
  await g.apply([{ entity: { eid: round }, $delete: true }])
  let unused: Bundle[] = []
  for (let b of shared) {
    let prop = b.variant ? 'variant' : 'case'
    let n = await g.read(
      `.writing .writing.${prop}=${JSON.stringify(b.entity.eid)} .limit=1`,
    )
    if (!n.length) unused.push({ entity: b.entity, $delete: true })
  }
  if (unused.length) await g.apply(unused)
  return all.length
}
