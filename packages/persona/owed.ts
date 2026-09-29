// The persona a checkout carries, and what an agent working in one is owed of
// it.
//
// A project's common persona is the one the project `contains` whose `home` is
// that project. A sub-project's agents hear every common persona along its
// lineage (@yaks/project): their own project's first, if it has one, then each
// one above it, folded into one document ({@link common}). The persona files
// write a checkout's into the checkout a person keeps as `.tasks/AGENTS.md`
// (./files.ts), and every checkout of the same repository carries the same
// persona, whether or not that file reaches it there: an agent's own worktree
// has the repository's links to `.tasks` but not the ignored directory they
// point into.
//
// So a harness starting an agent asks {@link owed} what to give it beside the
// instruction files its provider reads. A file says the persona only when its
// text is exactly the projection the persona files write, banner and all; one
// that names the same persona but was written before the graph last moved is
// stale, and the agent reading it is still owed the persona as it stands now.
// An agent working on a sub-project in its parent's checkout, whose file says
// the parent's persona, is owed what its own project adds.
//
// Pure reads of the graph: the caller reads the files, because only it knows
// which ones its provider reads.

import { and, eq, type Input, list, present } from '@yaks/query'
import {
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  Refused,
} from '@yaks/graph'
import { relations } from '@yaks/edge'
import { DOC, TITLE } from '@yaks/doc'
import { human } from '@yaks/id'
import { safe } from '@yaks/text'
import { lineage } from '@yaks/project'
import type { Vocab } from '@yaks/vocab'
import { PERSONA } from './comp.ts'
import { voice, type Worn } from './voice.ts'
import { beside, CARRIES, fold, wear } from './worn.ts'

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let str = (v: unknown): string => v == null ? '' : String(v)

let value = (eids: Eid[]): Input => eids.length == 1 ? eids[0] : list(...eids)

let eidOf = (b: Bundle): Eid => b.entity.eid

/** Each project's common persona: the one it `contains` whose home is that
 * project. A project with none is left out. */
export let commons = async (
  g: Graph,
  projects: Eid[],
): Promise<Map<Eid, Bundle>> => {
  let out = new Map<Eid, Bundle>()
  let tag = relations(g.vocab)[CARRIES]
  if (!tag || !projects.length) return out
  let homed = await g.storage.read(
    and(present(PERSONA), eq(`${PERSONA}.home`, value(projects))),
  )
  if (!homed.length) return out
  let held = new Set(
    (await g.storage.read(
      and(
        eq('edge.from', value(projects)),
        eq('edge.to', value(homed.map(eidOf))),
        present(tag),
      ),
    )).map((b) => `${comp(b, 'edge').from}|${comp(b, 'edge').to}`),
  )
  for (let p of homed.toSorted((a, b) => eidOf(a).localeCompare(eidOf(b)))) {
    let home = str(comp(p, PERSONA).home)
    if (!out.has(home) && held.has(`${home}|${eidOf(p)}`)) out.set(home, p)
  }
  return out
}

/** The common persona an agent working on `eid` (a task, or a project) hears:
 * each common persona along its lineage, nearest first, folded into one. A
 * sub-project without one of its own hears its parent's. */
export let common = async (
  g: Graph,
  eid: Eid,
): Promise<Worn | undefined> => {
  let line = (await lineage(g, eid)).map(eidOf)
  let bases = await commons(g, line)
  let wearing = wear(g.storage, g.vocab)
  let worn: Worn[] = []
  for (let p of line) {
    let base = bases.get(p)
    let w = base && await wearing(eidOf(base))
    if (w) worn.push(w)
  }
  return worn.length ? fold(worn[0], ...worn.slice(1)) : undefined
}

/** The line a persona file opens with: which persona it was generated from,
 * and where to edit it. */
export let banner = (vocab: Vocab): (persona: Bundle) => string => {
  let id = human(vocab)
  return (p) =>
    `<!-- GENERATED from ${id(p)} (${safe(str(comp(p, DOC)[TITLE]))}) — ` +
    'edit it in the graph, never here: the next sync overwrites hand edits. -->'
}

/** A persona as the file projecting it into a checkout says it: its
 * {@link banner}, then its {@link voice}. */
export let projection = (vocab: Vocab): (worn: Worn) => string => {
  let head = banner(vocab)
  let render = voice(vocab)
  return (w) => `${head(w.persona)}\n\n${render(w)}`
}

/** What an agent is owed: the persona's id, and its text. */
export type Owed = { source: string; text: string }

/** Who an agent is: a persona chosen for it, or the work it is on (a task, or
 * a project), whose lineage's common persona it hears. */
export type As = { persona?: string; work?: Eid }

// The common persona of the checkout at `path`: the first project filed with
// its repository, by eid, that has one along its lineage.
let carried = async (g: Graph, path: string): Promise<Worn | undefined> => {
  let needs = ['worktree', 'repo', 'project', PERSONA]
  if (!needs.every((c) => g.vocab.comp(c))) return
  let repos = (await g.storage.read(and(eq('worktree.path', path))))
    .map((b) => str(comp(b, 'worktree').repository)).filter(Boolean)
  if (!repos.length) return
  let projects = (await g.storage.read(
    and(present('project'), eq('repo.repository', value(repos))),
  )).filter((b) => !b.archived).map(eidOf).sort()
  for (let p of projects) {
    let w = await common(g, p)
    if (w) return w
  }
}

/**
 * What an agent working in the checkout at `path` is owed of its persona,
 * given the text of each instruction file its provider reads there. By
 * default that is the common persona the checkout's repository carries;
 * `as.work` makes it the common persona of the work's lineage, less whatever a
 * file there already says of the checkout's. Nothing when a file already says
 * it all, when the graph knows no checkout at `path` and no work, or when
 * nothing along the way has a common persona. `as.persona` selects a graph
 * persona instead, even when the checkout is not known to the graph.
 *
 * ```ts ignore
 * let owes = await owed(g, '/srv/runs/S-1', [agentsMd], { work: 'T-7' })
 * if (owes) args.push('--append-system-prompt', owes.text)
 * ```
 */
export let owed = async (
  g: Graph,
  path: string,
  files: string[],
  as: As = {},
): Promise<Owed | undefined> => {
  let says = (w: Worn) => files.includes(projection(g.vocab)(w))
  let owes = (w: Worn): Owed => ({
    source: human(g.vocab)(w.persona),
    text: voice(g.vocab)(w),
  })
  if (as.persona) {
    let found = await g.address([as.persona])
    let worn = await wear(g.storage, g.vocab)(
      found.get(as.persona) ?? as.persona,
    )
    if (!worn) throw new Refused(`no persona called ${as.persona}`)
    return says(worn) ? undefined : owes(worn)
  }
  let here = await carried(g, path)
  let worn = (as.work && await common(g, as.work)) || here
  if (!worn || says(worn)) return
  return owes(here && says(here) ? beside(worn, here) : worn)
}
