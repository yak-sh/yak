// The two pieces of text this package is careful about: what goes INTO an FTS5
// MATCH, and what comes back marked.
//
// FTS5's match syntax is a small language of its own — quotes, NEAR, boolean
// words, column filters. A search box's contents are none of that: they are
// what a person typed. So a search word is always spelled as a QUOTED PHRASE,
// which makes every character in it literal, and the one piece of grammar a
// person can reach is a trailing `*`, which prefix-matches the final word.
//
// Hits come back wrapped in two control characters rather than HTML. A snippet
// is content, and content that arrives as markup is markup a renderer has to
// trust; a control character is a mark no browser and no terminal will act on,
// which every renderer can turn into whatever emphasis it likes.

// The marks a snippet wraps each hit in.
export let OPEN = '\x01'
export let CLOSE = '\x02'

// A person's search text as a safe FTS5 MATCH term: one quoted phrase, with a
// trailing `*` kept as a prefix search. Answers '' for text with no word in it —
// a caller reads that as "matches nothing", never as "matches everything".
export let term = (text: string): string => {
  let prefix = /\*+$/.test(text)
  let phrase = text.replace(/\*+$/, '').replaceAll('"', '').trim()
  return phrase ? `"${phrase}"${prefix ? '*' : ''}` : ''
}
