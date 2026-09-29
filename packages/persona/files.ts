// The persona files: each project's personas written into its checkout, where
// a harness started there finds them. The persona a project `contains` is
// `.tasks/AGENTS.md`, which a repository's CLAUDE.md and AGENTS.md link to,
// and every other persona whose `home` is the project is
// `.tasks/personas/<name>.md`, which a `.claude/agents/<name>.md` links to. A
// sub-project without a checkout of its own lands in its nearest ancestor's,
// so its personas, its common one included, are specialists there.
//
// The text is {@link voice}'s. A file adds only what being a file needs: a line
// saying where to edit it, and, for a specialist, the frontmatter a Claude
// agent file has to open with (without `name` and `description` first, claude
// reports the agent as not found). A specialist says its home's common persona
// too, and is read beside AGENTS.md, so what AGENTS.md already says is left out
// of it rather than said twice. Which persona is a project's common one, and
// the text of its file, are ./owed.ts's, the same answers a harness asks for an
// agent's own checkout.
//
// A write-only @yaks/mirror binding: the graph owns these files. A hand edit
// is put back, and one made while the graph also moved is a conflict, left as
// it is. Every file already under an owned `.tasks` directory is in the binding
// too, so a renamed or deleted persona's file is removed.
//
// Which checkout is borrowed, not declared here: a project's `repo.repository`
// (@yaks/project) and that repository's main worktree (@yaks/git), the one
// whose own Git directory is the repository's common one. Every linked
// worktree is an agent's or a session's, whoever cut it; the main one is where
// a person works. A graph composed without either package has no checkouts,
// and writes no files. An archived project keeps what it last had.

import { type Binding, memo, present as exists } from '@yaks/mirror'
import { and, eq, type Input, list, present } from '@yaks/query'
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { DOC, TITLE } from '@yaks/doc'
import { human } from '@yaks/id'
import { lineage } from '@yaks/project'
import { PERSONA } from './comp.ts'
import { voice, type Worn } from './voice.ts'
import { beside, fold, wear } from './worn.ts'
import { banner, common, projection } from './owed.ts'

/** One file the graph says a checkout holds. */
export type File = { path: string; text: string }

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let str = (v: unknown): string => v == null ? '' : String(v)

let value = (eids: Eid[]): Input => eids.length == 1 ? eids[0] : list(...eids)

let eidOf = (b: Bundle): Eid => b.entity.eid

// Each project's checkout root: the main worktree of its repository, which
// Git knows by its own directory being the common one. Whoever cut a linked
// worktree, by hand or by a tool, it is never the one. A checkout moved
// leaves its old row behind, so the first by path wins, and the answer never
// depends on the order rows come back in.
let checkouts = async (g: Graph): Promise<Map<Eid, string>> => {
  let out = new Map<Eid, string>()
  let needs = ['repo', 'repository', 'worktree']
  if (!needs.every((c) => g.vocab.comp(c))) return out
  let projects = (await g.storage.read(
    and(present('project'), present('repo')),
  )).filter((b) => !b.archived && comp(b, 'repo').repository)
  let repos = [...new Set(projects.map((b) => str(comp(b, 'repo').repository)))]
  if (!repos.length) return out
  let common = new Map<Eid, string>()
  for (let r of await g.get(repos)) {
    let dir = str(comp(r, 'repository').common)
    if (dir) common.set(eidOf(r), dir)
  }
  if (!common.size) return out
  let mains = (await g.storage.read(
    and(eq('worktree.gitdir', value([...new Set(common.values())]))),
  ))
    .map((b) => comp(b, 'worktree'))
    .filter((w) => w.path && w.gitdir == common.get(str(w.repository)))
    .sort((a, b) => str(a.path).localeCompare(str(b.path)))
  for (let p of projects) {
    let tree = mains.find((w) => w.repository == comp(p, 'repo').repository)
    if (tree) out.set(eidOf(p), str(tree.path))
  }
  return out
}

// The name a persona registers under as a Claude agent: its alias
// (@yaks/alias keeps one as a `key`), reduced to claude's charset, or its
// lowered id where it has none. The file is named for it too, because claude
// keys an agent by its frontmatter `name`, and a harness resolves the file by
// its own.
let names = async (g: Graph, eids: Eid[]): Promise<Map<Eid, string>> => {
  let out = new Map<Eid, string>()
  if (!eids.length || !g.vocab.comp('alias') || !g.vocab.comp('key')) {
    return out
  }
  let keys = (await g.storage.read(
    and(eq('key.of', value(eids)), present('alias')),
  )).map((b) => comp(b, 'key')).sort((a, b) =>
    str(a.value).localeCompare(str(b.value))
  )
  for (let k of keys) {
    if (!out.has(str(k.of))) out.set(str(k.of), str(k.value))
  }
  return out
}

let slug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')

/** What the persona files are: each file's path and text, the `.tasks`
 * directories they are written into (where a file the graph no longer says is
 * found), and every entity a file says something about. */
export type Files = { files: File[]; roots: string[]; said: Set<Eid> }

/** Every persona file the graph says its checkouts hold. */
export let personaFiles = async (g: Graph): Promise<Files> => {
  let homes = await checkouts(g)
  let files: File[] = []
  let said = new Set<Eid>()
  if (!homes.size) return { files, roots: [], said }
  let id = human(g.vocab)
  let render = voice(g.vocab)
  let wearing = wear(g.storage, g.vocab)
  let heard = (w: Worn): Worn => {
    for (let b of [w.persona, ...w.carries, ...w.names]) said.add(eidOf(b))
    return w
  }
  // Each project's common persona along its lineage, read once a pass.
  let shared = new Map<Eid, Worn | undefined>()
  let everyone = async (project: Eid) => {
    if (!shared.has(project)) {
      let w = await common(g, project)
      shared.set(project, w && heard(w))
    }
    return shared.get(project)
  }
  let personas = await g.storage.read(and(present(PERSONA)))
  let named = await names(g, personas.map(eidOf))
  // The checkout each home lands in: the nearest project along its lineage
  // that has one, so a sub-project's personas are written into its parent's.
  let lands = new Map<Eid, Eid | undefined>()
  for (let home of new Set(personas.map((p) => str(comp(p, PERSONA).home)))) {
    if (!home) continue
    let line = (await lineage(g, home)).map(eidOf)
    lands.set(home, line.find((p) => homes.has(p)))
  }
  let head = banner(g.vocab)
  let agents = projection(g.vocab)
  for (let [project, root] of homes) {
    let dir = `${root}/.tasks`
    let base = await everyone(project)
    if (base) files.push({ path: `${dir}/AGENTS.md`, text: agents(base) })
    for (let p of personas) {
      let home = str(comp(p, PERSONA).home)
      if (lands.get(home) != project || eidOf(p) == base?.persona.entity.eid) {
        continue
      }
      let w = await wearing(eidOf(p))
      if (!w) continue
      let own = await everyone(home)
      let whole = heard(own ? fold(w, own) : w)
      let name = slug(named.get(eidOf(p)) ?? id(p))
      let title = str(comp(p, DOC)[TITLE])
      files.push({
        path: `${dir}/personas/${name}.md`,
        text: `---\nname: ${name}\ndescription: ${JSON.stringify(title)}\n` +
          `---\n${head(p)}\n\n${render(base ? beside(whole, base) : whole)}`,
      })
    }
  }
  let roots = [...new Set(homes.values())].map((r) => `${r}/.tasks`)
  return { files, roots, said }
}

// What an owned directory holds now: its AGENTS.md and its personas. Owned
// end to end, so anything of those two shapes is ours.
let held = (dir: string): string[] => {
  let out = [`${dir}/AGENTS.md`]
  try {
    for (let e of Deno.readDirSync(`${dir}/personas`)) {
      if (e.isFile && e.name.endsWith('.md')) {
        out.push(`${dir}/personas/${e.name}`)
      }
    }
  } catch { /* no specialists here */ }
  return out
}

/** Where a graph remembers what each persona file last agreed on: a file
 * beside its database, or nothing for a graph in memory. */
export let remembered = (
  db: string | undefined,
): Pick<Binding, 'agreed' | 'remember'> =>
  !db || db == ':memory:' ? { agreed: () => Promise.resolve(new Map()) } : memo(
    `${db.slice(0, db.lastIndexOf('/') + 1) || './'}mirror/personas.json`,
  )

/** The persona files as a write-only @yaks/mirror binding — hand it to
 * `sync` to write them, or to `plan` to see what would change — and every
 * entity they say something about. */
export let personaMirror = async (
  g: Graph,
  memory: Pick<Binding, 'agreed' | 'remember'>,
): Promise<{ binding: Binding; said: Set<Eid> }> => {
  let { files, roots, said } = await personaFiles(g)
  let paths = new Set([...files.map((f) => f.path), ...roots.flatMap(held)])
  return {
    binding: {
      name: 'personas',
      files: () => exists([...paths]),
      values: () =>
        Promise.resolve(new Map(files.map((f) => [f.path, f.text]))),
      ...memory,
    },
    said,
  }
}
