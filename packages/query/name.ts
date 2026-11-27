// The names a clause head is written in, shared by the parser and completion.
// A name is one of three things (D-338):
//
// - a bare label, the word alone: `cost`, `doc`, `sol62_book`;
// - a full label, a namespace's label, a colon and the word:
//   `yourname/trip:cost`, `@yaks/model:cost`;
// - an identity, a canonical UUID: `0f8fad5b-d9cb-469f-a165-70867728950e`.
//
// The grammar only reads which of them is written; what each one means is the
// vocabulary's to say.

// A bare label: a letter or underscore and then letters, digits or
// underscores (the names vocab.json allows, `sol62_book`), with a hyphen only
// before a letter, so `.requires->x` ends its name before the arrow.
export let SEG = '[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z_][A-Za-z0-9_]*)*'

// A namespace's label: a package (`@yaks/model`) or an app (`yourname/trip`).
let NS = '@?[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*'

// A canonical UUID, read only where it ends the name: one running on into
// more of a word (`…950ex`, `…950e-x`) is not an identity, and a hyphen after
// it may only begin the walk's `->`.
let UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' +
  '(?![A-Za-z0-9_]|-(?!>))'

// One name. The identity and the full label are tried first, since a bare
// label would read only their first part (`yourname`, `abcdef12`).
export let NAME = `(?:${UUID}|${NS}:${SEG}|${SEG})`

// A dotted path of names: a component, then a property, then on past a
// reference.
export let WORD = `${NAME}(?:\\.${NAME})*`
