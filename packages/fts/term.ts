// The two pieces of text this package is careful about: what goes into an FTS5
// match, and what comes back marked.
//
// FTS5's match syntax is a small language of its own — quotes, near, boolean
// operators, column filters. What a person types into a search box is none of
// that; it is just text. So every word is written as a quoted phrase, which
// makes each character in it literal, and the only match syntax a person can
// reach is two things: a quoted run, which stays one phrase, and a trailing
// `*`.
//
// Words, not one phrase. What somebody types is a set of words — `entropy
// purge`, or a whole question — and each word becomes a term of its own, ANDed
// together and ranked by relevance (./search.ts). Turning the whole string into
// a single phrase would match only where those words appear next to each other
// in that order, which means a question typed into a search box finds nothing
// at all. A bare word also matches as a prefix, so `research` finds
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

// One typed word, or one quoted run, as a safe FTS5 term: every character in it
// literal. A single word matches as a prefix, unless it is a common word (a
// grammatical word is whole as typed) or its last token is shorter than three
// letters: FTS5 reads a prefix by merging every token it begins, and `a*`,
// `of*`, or the `s*` that ends `step's`, merges a large share of a big index
// for a word nobody meant to complete. A run becomes a phrase, matched
// exactly, and a trailing `*` makes its final word a prefix match. Returns ''
// for text containing no word — a caller must read that as "matches
// nothing", never as "matches everything".
export let term = (text: string): string => {
  let star = /\*+$/.test(text)
  let phrase = text.replace(/\*+$/, '').replaceAll('"', '').trim()
  if (!phrase) return ''
  let open = !/\s/.test(phrase) && !common(phrase) &&
    (phrase.match(TOKEN)?.at(-1)?.length ?? 0) > 2
  return `"${phrase}"${star || open ? '*' : ''}`
}

// A token as FTS5's default tokenizer reads one: a run of letters and digits.
let TOKEN = /[\p{L}\p{N}]+/gu

// Grammatical words. They still take part in matching and ranking, as whole
// words; an excerpt leaves them unmarked, since they obscure the useful words
// and make FTS5 scan large matches just to cut the display text.
let COMMON = new Set(
  'a an and are as at be by for from in is it of on or the to was were with about after all also am any before between but can could did do does each had has have if into its may more my not our out per so than that their them there these this those through up we what when where which who will would your'
    .split(' '),
)

// Whether a typed word is one of the {@link COMMON} ones, its trailing
// punctuation aside. A quoted run never is.
let common = (word: string): boolean =>
  !word.startsWith('"') && COMMON.has(word.toLowerCase().replace(/\W+$/, ''))

// A quoted run is one token; everything else splits on whitespace. An unclosed
// quote takes the rest of the string, which is what somebody halfway through
// typing a phrase means by it.
let WORDS = /"[^"]*"?|\S+/g

// What somebody typed, as its words and quoted runs, each as typed.
export let split = (text: string): string[] => text.match(WORDS) ?? []

// A whole search string as an FTS5 match expression: each word becomes its own
// {@link term}, each quoted run becomes one phrase, and they are ANDed together
// (FTS5 treats a space that way). Order of results comes from the ranking, not
// from here. Returns '' for text containing no word, just as `term` does.
export let match = (text: string): string =>
  split(text).map(term).filter(Boolean).join(' ')

// The words as a name is written: quotes and stars gone, one space between
// them. A hit whose whole text is this is the thing searched for by name
// (./search.ts ranks it first). Returns '' for text containing no word.
export let named = (text: string): string =>
  split(text)
    .map((word) => word.replace(/\*+$/, '').replaceAll('"', '').trim())
    .filter(Boolean).join(' ')

// The distinctive words of a text, each a search of its own: what a question
// is about once its grammatical words are gone. A quoted phrase stays whole.
export let keywords = (text: string): string[] =>
  split(text).filter((word) => !common(word))

// Mark distinctive words in a snippet, while still searching for *all* words.
// Keep quoted phrases intact, even those made only of common words, and a
// common word explicitly starred. If the query has nothing else, marking one
// word is better than a blank excerpt or an expensive snippet of all common
// terms.
export let excerpt = (text: string): string => {
  let words = split(text).filter((word) => word.endsWith('*') || !common(word))
  return words.length
    ? words.map(term).filter(Boolean).join(' ')
    : term(split(text).find((word) => term(word)) ?? '')
}

// How many of a needle's trigrams a substring test asks the index for. All of
// them would narrow no better than a spread: what one misses, the test that
// reads each row catches.
export let GRAMS = 8

// A `~=` needle as a query of a substring index (`contains: true`): up to
// `most` of its trigrams, spread from its start to its end, each quoted and
// all required. An index keeping only which rows hold each trigram answers
// the rows holding all of them, every row that holds the needle among them.
// Null for a needle shorter than a trigram, which the index cannot find.
///
/// grammed('wyrm') -> '"wyr" AND "yrm"'
/// grammed('a"b') -> '"a""b"'
/// grammed('ab') -> null
/// grammed('abcdefghij', 3) -> '"abc" AND "efg" AND "hij"'
export let grammed = (needle: string, most = GRAMS): string | null => {
  let chars = [...needle]
  let last = chars.length - 3
  if (last < 0) return null
  let n = Math.min(most, last + 1)
  let at = new Set(
    Array.from(
      { length: n },
      (_, i) => Math.round(n > 1 ? i * last / (n - 1) : 0),
    ),
  )
  return [...at]
    .map((i) => `"${chars.slice(i, i + 3).join('').replaceAll('"', '""')}"`)
    .join(' AND ')
}
