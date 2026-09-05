// Bare words: how a search term tests against text, with no index.
//
// A word in a query line is a full-text term, and a full-text index answers it
// by TOKEN, not by substring: `cat` finds "the cat sat" and not "catalogue".
// This module is that rule, spelled small — a token is a run of letters and
// digits, case-folded — so a search answered from memory selects what an index
// over the same words would select. Text outside that alphabet (a script whose
// case folding or word breaking differs) is where the two can part; a caller
// that needs index-exact membership asks the index.
//
// The one piece of grammar a person can reach is a trailing `*`, which
// prefix-matches the final word. Quotes are not grammar here: a term is always
// read as a literal phrase, so several words must appear in that order.

/** The tokens a piece of text holds: runs of letters and digits, case-folded. */
export let tokens = (text: string): string[] =>
  text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * A search term as a test over one piece of text. Answers `null` for text with
 * no word in it — a caller reads that as "matches nothing", never as "matches
 * everything".
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
