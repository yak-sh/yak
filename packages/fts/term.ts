// The two pieces of text this package is careful about: what goes INTO an FTS5
// MATCH, and what comes back marked.
//
// FTS5's match syntax is a small language of its own — quotes, NEAR, boolean
// operators, column filters. What a person types into a search box is none of
// that; it is just text. So every word is written as a QUOTED phrase, which
// makes each character in it literal, and the only match syntax a person can
// reach is two things: a quoted run, which stays one phrase, and a trailing
// `*`.
//
// WORDS, NOT ONE PHRASE. What somebody types is a set of words — `entropy
// purge`, or a whole question — and each word becomes a term of its own, ANDed
// together and ranked by relevance (./search.ts). Turning the whole string into
// a single phrase would match only where those words appear next to each other
// in that order, which means a question typed into a search box finds nothing
// at all. A bare word also matches as a PREFIX, so `research` finds
// `researching`: the tokenizer does not stem, and a word's ending is the part a
// person is least deliberate about. The cost is a wider match — `fix` also
// matches `fixture` — which is what the ranking is for. Quoting is how somebody
// asks for exactly those words, in that order.
//
// Matches come back wrapped in two control characters rather than in HTML. A
// snippet is content, and content that arrives as markup is markup a renderer
// has to trust; a control character is a mark no browser and no terminal acts
// on, and every renderer can turn it into whatever emphasis it likes.

// The characters a snippet wraps each match in.
export let OPEN = '\x01'
export let CLOSE = '\x02'

// ONE typed word, or one quoted run, as a safe FTS5 term: every character in it
// literal. A single word matches as a prefix; a run of words becomes a phrase,
// matched exactly, and a trailing `*` makes its final word a prefix match.
// Returns '' for text containing no word — a caller must read that as "matches
// nothing", never as "matches everything".
export let term = (text: string): string => {
  let star = /\*+$/.test(text)
  let phrase = text.replace(/\*+$/, '').replaceAll('"', '').trim()
  if (!phrase) return ''
  return `"${phrase}"${star || !/\s/.test(phrase) ? '*' : ''}`
}

// A quoted run is one token; everything else splits on whitespace. An unclosed
// quote takes the rest of the string, which is what somebody halfway through
// typing a phrase means by it.
let WORDS = /"[^"]*"?|\S+/g

// A whole search string as an FTS5 MATCH expression: each word becomes its own
// {@link term}, each quoted run becomes one phrase, and they are ANDed together
// (FTS5 treats a space that way). Order of results comes from the ranking, not
// from here. Returns '' for text containing no word, just as `term` does.
export let match = (text: string): string =>
  (text.match(WORDS) ?? []).map(term).filter(Boolean).join(' ')
