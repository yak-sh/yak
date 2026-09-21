// Bare words: how a search term tests against text, with no index.
//
// A bare word in a query is a full-text term, and a full-text index matches it
// by TOKEN, not by substring: `cat` finds "the cat sat" and not "catalogue".
// This module is that rule in miniature — a token is a run of letters and
// digits, lowercased — so a search answered from memory selects what an index
// over the same words would select. Text outside that alphabet (a script whose
// case folding or word breaking differs) is where the two can differ; a caller
// that needs results identical to the index has to query the index.
//
// The one piece of syntax a person can use here is a trailing `*`, which
// prefix-matches the final word. Quoting is handled by @yaks/query's tokenizer,
// which passes a quoted run through as one term; this module always treats a
// term as a literal phrase, so its words must appear in that order.

/** The tokens a piece of text holds: runs of letters and digits, lowercased. */
export let tokens = (text: string): string[] =>
  text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * A search term as a test over one piece of text. Returns `null` for a term
 * with no word in it — the caller reads that as "matches nothing", never as
 * "matches everything".
 */
export let search = (term: string): ((text: string) => boolean) | null => {
  let prefix = /\*+$/.test(term)
  let want = tokens(term.replace(/\*+$/, ''))
  if (!want.length) return null
  return (text) => {
    let hay = tokens(text)
    let last = want.length - 1
    for (let i = 0; i + want.length <= hay.length; i++) {
      let hit = want.every((w, j) =>
        j == last && prefix ? hay[i + j].startsWith(w) : hay[i + j] == w
      )
      if (hit) return true
    }
    return false
  }
}
