<!-- GENERATED from N-4053 (tasks-v2 baseline) — edit in the graph (http://127.0.0.1:5173/N-4053, memory_save), never here: the
next sync overwrites hand edits. -->

The tasks-v2 working voice: one graph, many doors — every change is an entity patch, every list a query. Work in your own worktree, land with ff-only, gate with check+test, verify end-to-end before done. The repo's CLAUDE.md carries the specifics; this persona carries what the fleet has learned.

## Preloaded

### M-4454 code style (JS/TS) — the ten rules

Normative for all fleet code (source: `docs/STYLE.md`, the owner's DNA). JS-flavored; carry the same values into any language's native idiom.

1. **`export let name = curried => arrow`** — small, config-first / data-last, composable. 2-space indent everywhere, no semicolons, single quotes, loose `==` by default. One expression per function where possible. `let` by default; `const` only for true module constants (often SCREAMING_CASE). Named `function` only where you need recursion/hoisting/`this`/generator. Wrap code + comments at 80 cols; break long arrows after `=>`.
2. **`///` doctests over prose.** Executable examples (`input -> output`, `~>` async/pattern, `/// let` setup, `// /` skip) are spec + docs + tests at once. Prose comments are for *rationale* — especially what's deliberately absent.
3. **No classes** unless long-lived identity — then public fields, arrow-bound methods, no deep/domain inheritance. Thin `extends` of platform types (`Error`, `EventTarget`, `HTMLElement`) is fine. Else a factory closure returning a plain object of functions; compose with mixins, not hierarchy. PascalCase filename = one identity module; lowercase = a function vocabulary.
4. **Effects are data.** Record them as events/tuples appended to state or a log, resolved by a separate pass — never performed inline where decided. All comms serialized through the store's state.
5. **Dispatch with a `when`-style table** (value-dispatch on a computed tag, `_` default). A small leaf `switch` is fine; the banned thing is the switch-shaped orchestrator sequencing phases. Prefer a ternary chain over a 3-case switch.
6. **Nil short-circuiting over defensive `if`s** — a `pipe` that stops on nil replaces most error plumbing. Errors are tiny `Error` subclasses used as control flow, plus `??` defaults — no result types, no wrapping layers. Async is transparent: go async only when an input is a promise.
7. **TypeScript, worn lightly.** `.ts` by default, named honestly. Types carry meaning at signatures and data boundaries; inference does the rest. Keep `///` doctests. No `as` casts, enums, `private`/`readonly` ceremony — simplest annotation that states intent.
8. **Names: short, lowercase, evocative** (`ok`, `walk`, `beget`, `tap`, `when`), 2–8 chars; the call site reads like a sentence. No verb-prefix ceremony (`createContext`→`context`); named imports so call sites read bare. Prefix/namespace only to *disambiguate*, never as ceremony. No `Manager`/`Factory`/`Impl`; variants get a suffix (`map`/`mapObj`), not an options bag.
9. **Don't build the speculative layer.** An abstraction earns its place by removing code from callers, not adding indirection. Leave a visible stub or a comment saying why the layer is absent.
10. **Build a vocabulary, then compose it.** A file reads top-to-bottom as later exports made of earlier ones (`export let inc = add(1)`). Complexity comes from composition, never a long phased body. Primitives are protocol-extensible. A module tops ~600 lines; grow a system as many small files, never a monolith.

### M-4474 document new fleet tooling in a memory so the fleet discovers it

When you build or discover new fleet tooling — a CLI verb, an MCP tool, a hook, a workflow, a colon-command — write a memory for it immediately (reference or feedback, unscoped so it rides every operator's `task context` digest).

Tooling nobody memorializes is invisible: the next operator learns it by accident, or the owner has to tell them. A one-line index in the digest is how the fleet finds out **passively** — put the knowledge where the need arises.

Applies to what you ship AND to what you notice someone else shipped.

### M-4455 code style (JS/TS) — module shape, the whole app, testing

Source: `docs/STYLE.md`. How a file, app, and test suite are shaped.

## Module shape
A file is a vocabulary composed top-to-bottom: `id`, `always`, `tap`, then `inc = add(1)`, `reject = compose(filter, negate)`. A function longer than ~10 lines is rare and always a genuine algorithm — there is no "orchestrator" function. State is an immutable-ish plain value threaded through functions ("mutation" is copy-tweak-return: `beget(env, e => e.k = v)`). Generators for streams of alternatives — laziness/backtracking fall out of `yield*`, not a scheduler class.

## The whole app
- **Platform is the framework.** Deno (permissions in the shebang), no `package.json`, no bundler, no build step — browser and server run the same ES modules; shared `lib/` is isomorphic.
- **~Zero dependencies, vendored.** Rare deps copied into `vendor/` via an import map. Server, test runner, DOM builder, store are hand-rolled small `lib/` files.
- **Pure core + thin imperative shell.** A pure curried data module (`sim.js`, its own doctests) + a small DOM shell (`main.js`: module-level `let` state, `querySelector` bindings, `addEventListener`, template-literal `innerHTML` or a variadic `tag()` builder, `requestAnimationFrame` loop). No JSX, no vdom, no reactive lib.
- **Server** is a hand-rolled ~60-line middleware `Application` (`app.use(fn)`, recursive stack) + small middlewares. Deploy is a Dockerfile running the dev server. HTML minimal: no `<head>`/`<body>`, unquoted attrs, one `type=module` script.

## Testing
No test-framework dependency, ever. Doctests are *discovered*: a runner scans for `///` lines and codegens a test module (`->` equality, `~>` pattern-match, `/// let` setup, `// /` skip). Scenario tests in `*.test.js` using a tiny in-repo `suite(name, ({it, equal, ok}) => …)`; benchmarks in `*.bench.js`. CI is one job running `bin/test`.

### M-4456 code style (CSS) — the scaling component system

Source: `docs/STYLE.md` (product ground truth: `cafe_car/app/assets/stylesheets/ui/`). Designed to scale — one file + one import + a var contract per component, so adding UI never touches existing files and re-skinning never touches structure. (yak-sh's own flat-CSS minimalism was an experiment that doesn't scale — don't imitate it.)

- **One file per component**; PascalCase filename = the block (`Card.css` → `.Card`). The `components.css` manifest is nothing but `@import` lines — a new component is one file plus one import.
- **Three-separator naming:** block `.Card` (PascalCase); element `.Card_Head` (underscore, PascalCase); modifier/state `.Button-primary`, `.Card-sticky` (hyphen, lowercase).
- **Custom properties are the variant + theming mechanism** — the scaling trick. A component declares local vars at the top and consumes them (`--background: var(--button)` … `background: var(--background)`); a variant just *re-points* a var (`.Button-primary { --background: var(--primary) }`), never re-declares rules. Semantic tokens layer over primitives (`--danger: var(--red)`) plus a calc-derived spacing scale (`--gap`, `--half-gap`, `--radius`); a theme is a var-override file. Structure and skin stay fully separable.
- **Lean on modern CSS:** zero-specificity `:where()`, `:is()`/`:has()`, native nesting `& + &`, container queries, `color-mix`, `color-scheme: light dark` with per-component dark overrides.
- Still **no preprocessor, no Tailwind, no build step.**

### M-4458 code style — the values, omissions, and which strata to imitate

Source: `docs/STYLE.md`. The meta-layer under every language rule: **small composable parts, examples over prose, no speculative abstraction.** `docs/STYLE.md` is normative for all fleet code; for a language it doesn't cover, carry these values into that idiom.

## What he deliberately omits (the clearest statement of the values, from the flux comments)
- **No middleware/thunks** — logic scatters out of reducers into closures; kills debuggability.
- **No keyed/combined reducers** — every reducer sees the full state and every action.
- **No action creators** — an abstraction that only renames things doesn't get built.
- **No memoized selector layer** — subscribers get the whole state.

The proof the style scales: `runtime.js` is a complete logic language in ~700 lines where every feature is a plain function over `env`, callable in isolation, each with its `///` doctest. Simple parts → complex whole.

## Which strata to imitate (provenance)
Both corpora have strata; imitate the **hand-written** layers, not agent-written or experimental ones.
- **yak-sh ground truth:** pre-2025 `lib/` (`fp.js`, `core.js`, `runtime.js`) + the `e50b58d` refit. **Not normative:** work-era TS relics, `const`-heavy playground dirs, the flat-CSS experiment, the OOP test wrapper, the post-2026-03 LLM burst (owner-reviewed but LLM-authored). The burst's reliable negative lesson: mimicry gets surface tokens right (`let`, doctests) and *module granularity* wrong (1,600-line monoliths where his hand writes many small files).
- **cafe_car ground truth:** everything before 2026-06-26, especially `lib/cafe_car/component.rb`, the `*_builder.rb` family, `core_ext/`, and the whole `ui/` CSS system. **Not normative:** operator-era paragraph-prose comments, copilot/dependabot commits, the `helpers.rb` `cat`/`cap` debt cluster.

His DNA register is terse + example-driven — never paragraph-essay comments. When mimicking surface tokens, get the granularity right: many small files, not a monolith wearing the right syntax.

### M-3715 delegation discipline

Owner direction (2026-07-20) on delegation in ~/code/tasks:

- **Worktree-only, one writer per worktree.** Every agent — harness spawns and the coordinator's own session — works in its own git worktree, lands via `git merge --ff-only`. Use the Agent tool's `isolation: "worktree"` for spawns; never let two agents share an index (the h1/domain-editor serialization was this lesson).
- **Harness spawns are the default and must integrate fully**: every spawn brief directs the agent to reify a session entity, claim its task under that identity, comment progress and completion (with sha), and release when done. The task body carries the full spec — the prompt is delivery, the task is the record.
- **Internal spawns** (wire-created sessions, `task spawn`) are for codex/other providers and well-specified cold-context work; at parity since T-3698 (auto-claim, session_peek, settle→bus). The harness is the reliability floor.
- **Communication flows through the graph, not harness-native channels**, wherever possible: comment on a session to steer it, comment on the task for the record; the comms bus delivers on the next tool call. Harness push notifications remain the wake channel until the graph grows one.

**Why:** if our system breaks, work continues on the floor; full integration means the board is always the truth about who is doing what.
**How to apply:** every Agent-tool spawn gets isolation worktree + the claim-discipline paragraph in its brief; prefer task bodies over prompt-only specs. Current thread: M-3714.

## Index

Recall a body by id (memory_recall / task show).

- M-4457 0.98 feedback: code style (Ruby/Rails) — the class-macro idiom
- M-4064 0.63 project: identity is faceted; personas differ by emphasis, not content · 1×
- M-4065 0.63 project: federation discipline: one home graph per entity, intents across boundaries, no consensus · 1×
- M-4066 0.63 feedback: agents take warm paths, not right paths — adoption is won structurally · 1×
- M-4061 0.62 project: vocabulary naming: artifacts get artifact names, pure acts keep _request
- M-4062 0.62 feedback: letters vs notices: email is for prose agents wrote; machine events are marked at mint
- M-4063 0.62 project: reference at authoring, resolve at delivery, record the served form
