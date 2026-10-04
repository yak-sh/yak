// RFC 2047 encoded-words, decoded for DISPLAY. Inbound mail subjects are
// stored exactly as received (`=?UTF-8?Q?...?=`); this is the read-side
// seam that turns them back into text. Q and B encodings, adjacent words
// joined with the separating whitespace dropped (the RFC's fold rule),
// and any word that won't decode — unknown charset, bad bytes, bad
// base64 — degrades to its raw token: a subject line never throws.
// Deliberately not a MIME library; only the display concern lives here.

let WORD = '=\\?([^?\\s]+)\\?([bq])\\?([^?\\s]*)\\?='

// Q: `_` is a space, =XX a hex byte, everything else rides through as
// the ASCII it already is.
let qBytes = (s: string) => {
  let out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let hex = s[i] == '=' ? s.slice(i + 1, i + 3) : ''
    if (s[i] == '_') out.push(32)
    else if (/^[0-9a-f]{2}$/i.test(hex)) {
      out.push(parseInt(hex, 16))
      i += 2
    } else out.push(s.charCodeAt(i))
  }
  return new Uint8Array(out)
}

let bBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/// unmime('=?UTF-8?Q?caf=C3=A9?=') -> 'café'
/// unmime('plain subject') -> 'plain subject'
export let unmime = (s: string) =>
  s
    .replace(new RegExp(`(${WORD})\\s+(?==\\?)`, 'gi'), '$1')
    .replace(new RegExp(WORD, 'gi'), (raw, cs, enc, text) => {
      try {
        let bytes = /b/i.test(enc) ? bBytes(text) : qBytes(text)
        return new TextDecoder(cs.split('*')[0], { fatal: true }).decode(bytes)
      } catch {
        return raw // unknown charset / bad bytes: the token stands as-is
      }
    })
