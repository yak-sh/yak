// A query tree sent where text goes arrives as `[object Object]`, which reads
// as two words that match nothing. The sender's bug, never a question.
let FORMATTED = /\[object [A-Z]\w*\]/
export let formatted = (line: string): string | null =>
  line.match(FORMATTED)?.[0] ?? null
