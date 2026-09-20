// The two pieces of text this package is careful about: what goes INTO an FTS5
// MATCH, and what comes back marked.
//
// FTS5's match syntax is a small language of its own — quotes, NEAR, boolean
// words, column filters. A search box's contents are none of that: they are
// what a person typed. So every word is spelled as a QUOTED phrase, which makes
// each character in it literal, and the grammar a person can reach is exactly
// two things: a quoted run, which stays one phrase, and a trailing `*`.
//
// WORDS, NOT A SENTENCE. What somebody types is a bag of words — `entropy
// purge`, or a whole question — and each word is a term of its own, ANDed and
// ranked by relevance (./search.ts). Spelling the whole string as one phrase
// answers only where those words are adjacent in that order, which is a
// sentence typed into a search box finding nothing at all. A bare word also
// PREFIX-matches, so `research` finds `researching`: the tokenizer does not
// stem, and a word's ending is the part a person is least deliberate about.
// The cost is a wider match — `fix` reaches `fixture` — which is what the
// ranking is for. Quoting is how somebody says they meant it exactly, and in
// that order.
//
// Hits come back wrapped in two control characters rather than HTML. A snippet
// is content, and content that arrives as markup is markup a renderer has to
// trust; a control character is a mark no browser and no terminal will act on,
// which every renderer can turn into whatever emphasis it likes.

// The marks a snippet wraps each hit in.
export let OPEN = '\x01'
export let CLOSE = '\x02'

// ONE typed word, or one quoted run, as a safe FTS5 term: every character in it
// literal. A lone word prefix-matches; a run of words is a phrase, matched as
// it stands, and a trailing `*` prefix-matches its final word. Answers '' for
// text with no word in it — a caller reads that as "matches nothing", never as
// "matches everything".
export let term = (text: string): string => {
  let star = /\*+$/.test(text)
  let phrase = text.replace(/\*+$/, '').replaceAll('"', '').trim()
  if (!phrase) return ''
  return `"${phrase}"${star || !/\s/.test(phrase) ? '*' : ''}`
}

// A quoted run is one token; anything else breaks on whitespace. An unclosed
// quote takes the rest of the string, which is what somebody halfway through
// typing a phrase means by it.
let WORDS = /"[^"]*"?|\S+/g

// A whole search string as an FTS5 MATCH: each word its own {@link term}, every
// quoted run one phrase, all of them ANDed (FTS5 reads a space that way). Order
// comes from the ranking, not from here. Answers '' for text with no word in
// it, exactly as `term` does.
export let match = (text: string): string =>
  (text.match(WORDS) ?? []).map(term).filter(Boolean).join(' ')
