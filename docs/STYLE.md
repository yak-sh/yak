# Code style

Normative for every line in this repo — human- or agent-written. When a rule
here and existing code disagree, the code is the bug.

## The shape of the code

- `export let name = arrow` — small, composable, data-last. `let` by default;
  `const` only for true module constants. Named `function` only where you need
  hoisting, recursion, or `this`.
- 2-space indent, no semicolons, single quotes, loose `==` by default. Code and
  comments wrap at 80 columns.
- **Names: short, lowercase, evocative** (`ent`, `cast`, `land`, `spec`). The
  call site must read like a sentence. No verb-prefix ceremony — `createContext`
  is `context`, `resolveIdent` is `ident`. A prefix earns its place only to
  disambiguate two vocabularies sharing a noun. No `Manager`/`Factory`/`Impl`; a
  variant is a suffix (`map`, `mapObj`), not an options bag.
- **Build a vocabulary, then compose it.** A file reads top-to-bottom as later
  exports made of earlier ones. Complexity comes from composition, never from a
  long body with phases; there is no orchestrator function. A file tops out
  around ~600 lines — grow the system as many small files.
- **Don't build the speculative layer.** An abstraction must remove code from
  callers, not add indirection. When a layer is deliberately absent, say so in a
  comment where it would have lived.
- TypeScript worn lightly: types carry meaning at signatures and data
  boundaries, inference does the rest. No `as` casts where an annotation will
  do, no enums, no ceremony that obscures the code.

## Comments

Comments say **why**, never what or when. Document the invariant the code can't
state, the deliberate absence, the trap for the next editor. Never narrate
history ("now uses X", "changed to Y") — git owns provenance. Terse beats
thorough; a paragraph is almost always the wrong size.

## The graph rules

- `src/types.ts` `comps` **is** the schema — one typed list that feeds the db
  allowlist (`cols()`), the dot-param router, the MCP tool docs, and the
  editors. A new column is one edit there plus its table column in `db.ts`.
- Server-stamped columns (`frozen_at`, `claimed_at`, session lifecycle) stay OUT
  of `comps` so no client can fake them; graph-typed ones go in `stamped` so
  readers of associations still see the edge.
- Migrations are additive, in place. Never a reseed, never a destructive rewrite
  — the db is live data.
- Kind is derived (`kindOf`) — an entity is what its components make it. Prefer
  a tag component (`repo`, `shelf`) over a new kind.

## The UI rules

- No build step, no bundler, no framework beyond vendored Preact + signals. The
  rare dependency is vendored into `src/vendor/` via the import map and must
  earn its place by deleting a subsystem.
- Components come from `block()`/`el()` (ui.tsx): CSS classes follow `.Block` /
  `.Block_Element` / `.Block-modifier`, styled in `styles.css` with custom
  properties as the variant mechanism — a variant re-points a var, never
  re-declares rules. Zero-specificity `:where()` for defaults any component rule
  may override.
- Everything renders through the registry (`Entity.tsx`): renderers match on
  components, most specific wins, and **null is a first-class render** — a
  section with nothing to say renders nothing. Specialize by adding a
  higher-scoring entry, not by editing the generic one.
- Every write goes through `mutate()` — optimistic local, broadcast wire. No
  view talks to the db, and the browser never learns a provider dialect
  (adapters normalize server-side).

## Tests

- Fast and terse — the whole suite runs in seconds, always against
  `DB_PATH=:memory:`. Write helpers that let one line assert one case; a test
  reads as a list of facts, not a script.
- Test names are full sentences stating the behavior ("search finds, follows
  edits, forgets the dead").
- Never delete a test to make the suite fast or green.

## Workflow

- Work in a worktree; land with `git push origin HEAD:main`. A worktree cannot
  merge into `main` — it is checked out in the shared tree, which refuses
  `merge`, `push .`, `fetch .` and `branch -f` alike. ff-only is the remote's
  job: a non-fast-forward push is rejected, which is the mechanism working —
  rebase on `origin/main` and push again, never `--force`.
- Gates before every push, strictly `&&`-chained so a failure stops the line:
  `deno fmt src/ && deno task check && DB_PATH=:memory: deno task test`. Read
  the output; never trust a log a skipped command "wrote".
- "Did it ship?" reads the remote. Nothing updates the shared checkout, so local
  `main` and the working tree answer confidently and wrongly:

  ```sh
  git fetch -q origin
  git merge-base --is-ancestor <sha> origin/main && echo shipped
  ```

- Keep commits focused; commit messages say why, in prose.
