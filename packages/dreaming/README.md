# @yaks/dreaming

Standing intentions an agent works on when nobody is asking it anything, and the
record of how often each memory has been recalled. It writes to the graph
supplied by the caller, not to a separate database.

```sh
deno add jsr:@yaks/dreaming
```

- `dream{scope}` — a standing intention filed under a project.
- `recall{count, first_at, last_at}` — how many times an entity has been
  recalled, and when it last was. This is the data dreaming works over.
- `recalled` — an edge relation: this entry recalled that entity, at this time.
- `meta` — marks text in a transcript as a note: it is never delivered to anyone
  live, and is read later by a dream.

`@yaks/dreaming/rules` adds `.order=hot` to every query: warmest first, by the
curve a recall decays along. Each recall earns a day of stability, spacing
multiplies it (the mean interval, in weeks), and the score falls off
exponentially past the last recall. An entity never recalled counts its own last
touch as one recall. A retired project, and whatever is filed under one, ranks
at a tenth.

The memories themselves belong to [@yaks/memory](../memory). This package covers
what happens to them between conversations.

## A dream is a builder

A dream runs as a [@yaks/builders](../builders) builder. It wears `builder`
beside `dream`, its `doc` body is the instruction, and anything it `reads` is an
input:

```
{ entity: { eid: '$d' }, dream: { scope: 'P-1' }, builder: {},
  doc: { body: 'Write up what is waiting.' } }
```

When it runs, which session opens, and where the session's answer is kept are
@yaks/builders' decisions and configuration: list that package beside this one
and configure its `desk` and `rest`. A dream reads as a `dream` (its `Z-` id)
rather than as a builder or a doc. This package runs nothing itself.

## Exports

- `@yaks/dreaming`: `dreamingDoc` and the `DREAM` and `RECALL` component names.
- `@yaks/dreaming/vocab`: the schema in `docs`.

## Compatibility

Deno and Node. Both exports are declarations with no runtime calls.
