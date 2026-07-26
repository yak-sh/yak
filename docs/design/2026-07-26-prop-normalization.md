# Prop normalization — one value language at every door

`PropType` already chooses storage columns, filter routes, docs, and browser
controls. It does not yet choose how a value is read or written. Priority
exposed the gap: `P2` meant one thing to the CLI shorthand, another to a write,
and nothing to a filter.

This design adds one scalar language to the vocabulary. Each type owns:

```ts
parse(type, input, context) -> canonical value
format(type, value, context) -> display string
```

Writes store the parsed value, filters compare parsed values, and generic
renderers show the formatted value. A rejected value names the type's accepted
grammar. Storage and filters never silently accept different languages.

## Canonical values

- `text`, `body`, `query`, `{text: well}`, and `url` store strings and display
  them unchanged.
- `number` stores a finite number. Decimal, signed, exponent, and leading-zero
  spellings collapse through `Number`.
- `priority` is a semantic numeric type. A string accepts an optional `P`
  prefix; `P02`, `p2`, and `2` store `2`. Numeric fractional board slots remain
  valid. It displays with one `P` prefix.
- `bool` stores `0` or `1`. `true`, `false`, `1`, `0`, `yes`, and `no` parse
  case-insensitively. It displays `true` or `false`.
- `time` stores `new Date(value).toISOString()`. ISO stamps and the existing
  time phrases parse through `instant()`; `today` becomes today's local
  midnight, `1 hour ago` that prior instant, and `in 60m` the future endpoint.
  It displays the canonical UTC stamp.
- `{enum}` stores the declared value. Values parse case-insensitively; an
  optional alias map is also case-insensitive and maps to declared values. It
  displays the declared value.
- `{eid}` stores a UUID or null. UUIDs pass through in lowercase; aliases, human
  ids, and bare numbers resolve through the graph supplied in context. It
  displays the target's human id and title when the graph is available, falling
  back to the UUID.

Null remains null. Empty input clears number, priority, bool, time, and eid
columns. Empty is a value for text-shaped types. An enum has no empty value;
clearing a required enum remains a loud database rejection.

Priority becomes a distinct `PropType` because prefix and display behavior are
part of what that column is. Making every number accept `P` would corrupt
geometry; checking `task.priority` in each consumer recreates the bug.

## Where the pair lives

`src/props.ts` owns the small type-dispatch table and exports `parseProp`,
`formatProp`, `propAt`, and batch normalization. It imports only `types.ts` and
the time vocabulary.

`span()` and `instant()` move from `query.ts` to `src/time.ts`. This avoids a
cycle: props parses scalar times, while query composes scalar parsing with
filter operators.

The context is capability-shaped:

```ts
type PropContext = {
  now?: number
  resolve?: (id: string) => string | undefined
  describe?: (eid: string) => string | undefined
}
```

Pure callers need no context. Reference parsing requires `resolve`; reference
formatting uses `describe` when supplied.

## Door inventory

### Writes

- `client.ts param()` routes a dot-param, looks up its `PropType`, and parses
  non-reference values. `derefParams()` completes reference parsing with its
  snapshot.
- `commands.ts`, the CLI, MCP sugar, and typed task specs already converge on
  those helpers.
- Browser and TUI editors call the same parser before optimistic mutation.
- `db.ts apply()` normalizes the whole batch before SQL. It resolves human ids
  from entity numbers and aliases. This is the final invariant for WebSocket,
  `/apply`, MCP, effects, and future writers.
- Dependency endpoints use the same eid parser; dependency verbs remain the edge
  vocabulary's enum.

`apply()` returns the normalized effective batch. The WebSocket server casts
that batch, rather than rebroadcasting the request bytes, including back to the
optimistic sender. This corrects a local phrase such as `today` to the stored
stamp and prevents peers from caching a spelling the database did not store.

### Filters

`query.ts pred()` knows the routed property's type, including the far side of a
reference path.

- Empty equality remains the absent-value operator and is not scalar input.
- Lists and numeric ranges parse each nonempty atom before comparison.
- Equality and ordered comparisons use canonical scalar strings.
- Contains remains a literal, case-insensitive text fragment.
- Enum and bool failures are loud at parse time.
- Eid equality/list atoms resolve in `resolveRefs()` with the same parser used
  by writes.
- Time is deliberately the one range-valued filter. `span()` validates and
  evaluates the phrase; the operator still picks the range edge. A saved board
  containing `today` must remain relative, so query parsing never freezes it
  into yesterday's absolute stamp.

Thus write-time `today` calls `instant()` once and stores a stamp, while
filter-time `today` calls `span()` whenever the saved query is evaluated.

### Rendering

- `client.ts showMd()` looks up the type in `comps + stamped` and calls
  `formatProp`; JSON remains canonical machine data.
- The browser prop registry wraps the formatted string with type-specific UI:
  time may add a local tooltip, url an anchor, and eid a link. The visible
  string still comes from `formatProp`.
- The priority badge, TUI task heading, and Debug task item consume the priority
  formatter instead of spelling `P` themselves.
- Custom views may add layout or links, but do not invent a second scalar
  spelling.

## Rejections

Every failure follows one shape:

```text
<prop> is <grammar> — got '<input>'
```

Examples include the enum's declared values, the boolean spellings, the numeric
grammar, time examples, or `human id / alias / UUID` for references. The
component-qualified property is included when the bare name is ambiguous.

`apply()` rejects the whole batch before changing rows. Query parsing rejects
before scanning. A browser editor keeps the old value and shows the error in its
existing interaction surface; a WebSocket rejection must no longer be silent.

## Existing data

A read-only audit on 2026-07-26 found:

- three tasks at the undeclared status `gone` (`T-6210`, `T-6461`, `T-6814`);
- one empty-string number, `S-7286 session.pid`;
- 3,103 valid UTC timestamps at second precision rather than millisecond
  precision: 2,456 `created.at`, 646 `mail.acted_at`, and one
  `project.retired_at`;
- no other invalid numbers, booleans, enum values, time values, or eid values.

The idempotent boot heal converts valid typed values through the same parser:
empty optional scalars become null and valid timestamps become millisecond UTC
stamps. It never guesses an invalid enum. T-7224 audits the three `gone` journal
histories and deliberately maps each task before enum enforcement lands.

The heal is derived from `comps + stamped`; adding a typed column cannot require
another hand-maintained migration list. Server-stamped values are audited and
formatted, but only wire-writable columns join apply normalization.

## Alternatives rejected

### Normalize only in `client.ts`

This leaves browser mutations, raw WebSocket batches, effects, and future doors
able to store a different value. A storage invariant belongs at `apply()`.

### Put functions inside `comps`

Functions would mix runtime behavior into the declarative schema, make schema
hashes unstable, and duplicate descriptors for repeated types. A dispatch table
over `PropType` preserves the one list without putting closures in it.

### Keep priority as a number plus a column check

That is the pilot's necessary local fix, not the general shape. Semantic display
syntax must be visible in the type or every consumer needs the same special
case.

### Freeze time filters during query parsing

An absolute parsed range is correct for a write and wrong for a saved board.
`today` on a board must advance with the day. Scalar `instant()` and filter
`span()` share one time vocabulary but have distinct lifetimes.

## Delivery order

1. Add the pure type pair, semantic priority, and extracted time vocabulary.
2. Route writes through it and make `apply()` return/cast canonical patches.
3. Route filters and renderers through it; remove every priority special case.
4. Heal canonicalizable stored values, audit the three enum violations, then
   enforce enum parsing at the storage boundary.
5. Gate with check and test, then probe CLI, MCP, HTTP, WebSocket, web, and TUI
   against one matrix of accepted spellings and loud failures.
