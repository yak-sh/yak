# @yaks/persona

Define human identities and agent instructions in a graph, and assemble an
agent's instructions into Markdown. The graph stores `person`, `persona` and
`skill` components alongside document text and relationships. This package
supplies their schemas and read/render functions, and writes each project's
personas and skills into its checkout; it opens no database and starts no agent.

```sh
deno add jsr:@yaks/persona
```

- `person` — a human being the graph knows, addressable by name.
- `persona{home}` — a set of instructions an agent runs with. The `doc` body on
  the same entity is the instruction text, and `home` is the project it works
  for. The component declares `governed`, meaning it should be associated with a
  project, so [@yaks/project](../project)'s check reports a persona no project
  can reach.
- `skill{invoke, arguments, paths, fork, options}` — instructions an agent loads
  on demand ([Repository skills](#repository-skills)).

A person identifies a human and a persona contains agent instructions. Keeping
them apart lets provenance fields such as `created.by` identify the actual
author. What a session wearing a persona is about is the session's, not the
persona's: a session opened on a topic ([@yaks/topic](../topic)) names it as
`session.topic` and wears one persona, the oracle, whatever the topic.

## Rendering a persona

A persona links to the documents it is built from — a `contains` edge for each
document included in full, a `reads` edge for each one mentioned by id only —
and those documents, plus the persona's own body, render as a single markdown
document: what an agent is given at the top of its context.

The example creates an in-memory graph and renders one persona. An entity is a
record with an id; a bundle is a JSON object containing that entity's
components. Use a persistent storage adapter instead of `ram` to retain these
records.

```ts
import { docDoc } from '@yaks/doc'
import { graph } from '@yaks/graph'
import { personaDoc, voice, wear } from '@yaks/persona'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab([docDoc, personaDoc])
let storage = ram(vocab)
let g = graph({ storage, vocab })
await g.apply([{
  entity: { eid: 'reviewer' },
  persona: {},
  doc: { title: 'Code reviewer', body: 'Check changes against the tests.' },
}])
let worn = await wear(storage, vocab)('reviewer')
if (worn) console.log(voice(vocab)(worn))
```

`wear(storage, vocab)(eid)` reads a persona by its stored entity id and follows
its document relationships. It needs only a storage's `read` and `get`
(`Reads`), so a page can hand it one answered from what the page holds. It
returns `undefined` if that entity is missing or is not a persona.
`voice(vocab)(worn)` returns Markdown containing the persona's instructions,
each included document in full, and a `Reads` list of referenced documents. Load
@yaks/edge plus the schemas declaring `contains` and `reads` to use those
relationships. The minimal example has no linked documents.

Rendering behavior:

Five things this shape decides:

- **It returns text.** Where the document goes — `AGENTS.md` in a repo, the
  system prompt of a spawned agent, a card in a browser — is the caller's
  decision. The persona files below are one caller.
- **A proposal is not said.** A document carrying [@yaks/kernel](../kernel)'s
  `proposed` is left out, by either edge, until a `decided` approves it; a
  declined one stays out. Linking a proposal to a persona files it where it
  belongs without making the persona say it.
- **A linked entity's words stay where they are.** Its title is `doc.title` and
  its text is `doc.body`, falling back to `content.body` when the doc body is
  empty or absent. A [memory](../memory) marked on a comment or transcript entry
  renders those words in full, just as a memory on a doc does. A linked entity
  needs `doc` or `content`; its kind does not decide whether it is included.
- **An included persona's documents are included recursively.** Its instruction
  text is included like any other document, and the documents it links to are
  added to the ones this persona links to, so a base persona reaches every
  persona built on top of it and nobody copies its text. A persona linked by
  `reads` is only listed by id.
- **A contained tool is offered, not said.** A registered tool
  ([@yaks/tools](../tools)' `tool{name}`) that a persona contains, or that a
  persona it includes contains, is in `worn.tools` and never in its text.
  `offer(worn)` names them, and a native session wearing the persona is offered
  those tools and no others ([@yaks/harness](../harness)). A persona containing
  none leaves a session its runner's own tools. `wearing(g, path, as)` is the
  persona an agent wears, chosen or common, whatever its files already say.

At each nesting level, documents are ordered by their edge's `ord` property,
then by the target entity id. Missing `ord` values sort last. Nested personas
are read breadth-first for up to eight levels; cycles and repeated inclusions
are removed. Full inclusion takes precedence over a `reads` reference. This
stable ordering replaces the legacy materializer's time-decaying score, which
could change output even without a graph write.

## The persona files

A harness started in a checkout reads its instructions from files, so each
project's personas are written into its checkout:

- the persona the project `contains` is `.tasks/AGENTS.md`, which the
  repository's `CLAUDE.md` and `AGENTS.md` link to (for a sub-project with a
  checkout of its own, folded with the common personas above it);
- every other persona whose `home` is the project, or a sub-project landing in
  its checkout (below), is `.tasks/personas/<name>.md`, which a
  `.claude/agents/<name>.md` links to. `<name>` is the persona's
  [@yaks/alias](../alias) name, or its id. The file opens with the frontmatter a
  Claude agent file needs (`name`, `description`), and leaves out what
  `AGENTS.md` already says, since the two are read together.

Each file is `voice`'s text under a line naming the persona it was generated
from. The checkout is the main worktree of the project's
[@yaks/project](../project) `repo` → [@yaks/git](../git) `repository`: the
`worktree` whose `gitdir` is the repository's `common` directory. A linked
worktree never gets the files, whoever cut it. An archived project keeps what it
last had.

The files are a write-only [@yaks/mirror](../mirror) binding: the graph owns
them. A hand edit is put back; one made while the graph also moved is left and
reported; the file of a renamed or deleted persona is removed. What each file
last agreed on is kept in `mirror/personas.json` beside the database.

`persona_sync` writes them (`check` reports what would change instead). A host
keeps them current after every write that touches a persona or a document one
says, when its config asks:

```json
{ "use": "@yaks/persona", "with": { "files": true } }
```

It is off by default because the paths come from the graph, not the database: a
host opened on a copy of a graph would write into the checkouts the original
names.

## Repository skills

Skills are reusable instructions, not tools. A skill has a stable minted id and
`skill{invoke, arguments, paths, fork, options}` beside `doc{title, body}` and
`content{body}`. The title is its folder name, the document body is its short
description, and the content body is the instructions. Unknown Claude YAML
fields survive in `options`; parsing does not run or expand them.

A `references` edge from the skill to a separate `file{path, root}`
([@yaks/file](../file)), rooted in the repository, locates its
`.claude/skills/<title>/SKILL.md`. The locator uses the existing file identity
and has no content. Companion files use `file` plus `content`. Renaming a title
keeps the skill id, moves its companions, and changes the locator only after the
repository change lands. An unlinked skill remains readable in the graph but
cannot be exported into a repository.

```ts ignore
import { loadSkill, skillsAt } from '@yaks/persona/skills'
import { syncSkills } from '@yaks/persona/skill-mirror'

let catalogue = await skillsAt(graph, sessionCheckout)
let skill = await loadSkill(graph, 'testing', sessionCheckout)
let report = await syncSkills(
  graph,
  primaryCheckout,
  '/tmp/skills-baseline.json',
)
```

`skillCatalog(graph, repository?)` returns descriptions without instruction
bodies; `graphSkill(graph, title, repository?)` loads one exact graph skill.
`repoSkills(graph, repository?)` reads complete graph skills. With a repository,
it reads only that repository’s instruction bodies and refuses ambiguous
locators on each selected skill. `skillScope(graph, repository)` returns those
`skills` and their `places` together for consumers that need both.
`skillLocation` follows one locator and `skillLocations(graph, skills)` resolves
a batch of locators together. `skillFiles(graph, repository)` renders
repository-relative text; `renderFiles(skills, locations, files)` renders an
already-read snapshot without further graph reads. `skillsAt` and `loadSkill`
overlay a session checkout's actual files read-only: local edits, additions and
deletions are visible without importing them. A missing or ambiguous title is
refused. Instructions are loaded by title only when needed; discovery needs just
titles and descriptions.

`syncSkills` uses [@yaks/mirror](../mirror) to reconcile tracked text files in
the primary checkout with graph values, on whichever branch it has checked out.
Only current local checkouts are polled. Imports are atomic, attributed and
guarded against concurrent graph changes. Concurrent file/graph changes are
conflicts, not last-writer wins. Exports use a clean dedicated linked worktree,
commit only skills and land before updating the agreement. A dirty primary
checkout blocks pending exports. A git-common lock serializes manual and
automatic passes.

The host enables this independently of persona files:

```json
{ "use": "@yaks/persona", "with": { "skills": true } }
```

The awaited `skill_files` effect reconciles graph edits; `skill_watch` polls the
files continuously with a singleton watcher lease. A poll only stats what a sync
would read (each root's Git index and HEAD and everything under
`.claude/skills`) and syncs when that moved, while anything changed within the
last two seconds (an equal-size rewrite in one timestamp tick moves no stat), or
when the last sync of a root left a conflict or refusal. Per-root agreements are
stored under `mirror/skills` beside the configured database. Without a database
(or with `:memory:`), effects retain agreement bytes in instance memory and
materialize an owned temporary directory for each awaited handler batch. A live
watcher keeps that directory until shutdown or failure; cleanup is awaited. They
never fall back to another host's database environment. This option is off by
default because repository paths come from the graph.

## What an agent is owed

The persona files reach only the checkout a person keeps. An agent's own
worktree of the same repository has the repository's `AGENTS.md` link but not
the ignored `.tasks` directory it points into. So a harness starting an agent
asks what it is owed:

```ts ignore
import { owed } from '@yaks/persona'

let owes = await owed(graph, checkout, [agentsMdText])
// owes: { source: 'N-4053', text: '# N-4053 …' } | undefined
```

`owed(graph, path, files)` finds the project whose repository has a checkout
holding `path` (the nearest directory at or above it the graph knows as a
worktree), and returns its common persona (`source` is its id, `text` is
`voice`'s rendering), unless one of `files` (the text of each instruction file
the agent's provider reads there) is exactly that persona's file: the same
banner and the same text the persona files would write now. A stale file, or
another repository's, leaves the persona owed. The harness gives it through the
provider's own instruction mechanism and the provider still reads its files. A
fourth argument says who the agent is: `{ persona }`, a persona id or registered
name, chooses that persona instead of the checkout's common one (an unknown
persona is refused); `{ work }`, the task or project the agent works on, makes
it the common persona of the work's lineage, less what a file there already says
of the checkout's.

`carried(graph, path)` is that common persona alone, as `wear` returns it: the
persona a session started anywhere in the checkout wears (@yaks/session's
`session_context`).

## Sub-projects

A sub-project ([@yaks/project](../project)) hears every common persona along its
lineage: its own first, if it has one, then each project's above it, folded into
one document with nothing said twice. One without a persona of its own hears its
parent's. One without a `repo` of its own lands in its nearest ancestor's
checkout, so its personas, its common one included, are written there as
specialists, each saying its home's common persona beside the checkout's
`AGENTS.md`.

## The desk

`@yaks/persona/views` draws what agents are given wherever the browsing app
([@yaks/browse](../browse)) does, in a browser and a terminal alike, as a
writer's desk: every persona and skill on one side, the one being written in the
middle, and what an agent gets on the other.

The sidebar offers it as **Context** (`destinations`), at `/?context`: every
persona with the project it works for and every skill with its description
(`Context.Page`). A field over them finds one by the words of its title and
description; Enter opens the first, and Escape clears it. What is typed there is
the person's draft, through the UX host's `drafts` (@yaks/ux).

A persona or a skill opens on its `Context` tab: the desk, titles only, the one
open lit; its **binder** in the middle; and on the right what an agent gets: a
session to try it, where the host draws a conversation (`Conversation`; browse's
chat), and the text it is given. Stacked, as on a phone, the binder comes first
and the desk last. The binder alone is `Binder`, and a card's face
(`Card.Context`):

- a persona's binder is its head, its title and the project it works for, and
  its own text, each changed where it stands as everywhere in browse (the title
  typed over, the project picked, the text read as markdown and typed over on a
  double-click: @yaks/inspect's `Words`); then a list for each relation it links
  to documents by, headed by the relation's name: **Contains** (`contains`
  edges: each said in full, in the order an agent is given them, `served`; a
  tool it contains is offered, not said) and **Reads** (`reads` edges: each
  listed by id and title under the text's `## Reads`); then, behind a press, the
  memories in its scope it has neither edge to. Contains and Reads are ordered
  lists edited in place (@yaks/inspect's `Held`): a row dragged between two
  others is put there, which writes its `edge.ord`, and a row opens where it
  stands on its document's title and body, to type over. A row dragged onto the
  other list moves its edge there, where it is dropped; onto the memories with
  neither edge, it loses both. Any row that drags its entity (@yaks/ux `drag`),
  a row of the desk or of any list in browse, drops the same way. A document
  both lists lead to is said once, in full, and the binder says so;
- a skill's binder is its name, its description and its instructions, each
  changed where it stands.

Each row is drawn by its own renderer, asked for as `Context.List.Tile`.

The **Markdown view** of a persona or a skill (`Markdown`, more specific than
any doc's, so it is the one browse's Markdown tab draws) is the text an agent
receives. A persona's is `voice` of `wear`, what `persona_read` returns and a
session wearing it is given, composed in the page by that same code over what
the page holds (@yaks/inspect's `useReading`) and composed again whenever a
write moves anything it read. A skill's is its SKILL.md (`renderSkill`). Either
is drawn as its source, as written.

## Exports

| subpath          | what it provides                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `.`              | `wear`, `voice`, `owed`, `wearing`, `offer`, `common`, the component names, and the vocabulary document |
| `./vocab`        | the component declarations alone                                                                        |
| `./tools`        | `runs(host)` — `persona_read` returns the Markdown, `persona_sync` writes                               |
| `./effects`      | `effects(host, {files, skills})` — independently enables persona files and skills                       |
| `./skills`       | Graph skill reads and read-only checkout views                                                          |
| `./skill-text`   | Portable skill parsing, frontmatter and rendering                                                       |
| `./skill-mirror` | `syncSkills`, `skillRoots` — bidirectional landed repository mirror                                     |
| `./views`        | `inspectViews()`, `tabs`, `destinations`, `icons` — the desk, as the browsing app draws it              |

The two edge relations are borrowed rather than invented here: `contains` is
[@yaks/task](../task)'s and `reads` is [@yaks/kernel](../kernel)'s. A relation
the composed vocabulary does not declare contributes nothing rather than
throwing — a graph with no `contains` in it has a persona that includes no
documents, which is a fair reading of that graph.

`host` in `runs(host)` is the process that opened the graph; its config names
the database the persona files' memory is kept beside. Tool calls supply the
graph separately.

## Compatibility

`.` and `./vocab` run in Deno, Node and the browser — they call no platform API.
`./views` are Preact components a host mounts through @yaks/inspect's contract.
`./tools` and `./effects` write files through Deno.
