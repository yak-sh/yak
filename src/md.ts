// The one markdown door. marked (vendored, GFM) replaces snarkdown: real
// <p> paragraphs, tables, strikethrough, task lists, and CommonMark's
// intra-word-underscore rule natively — the two behaviors we'd been
// patching in. breaks:true keeps the comment-app convention: a single
// newline is a line break, like every task tracker people write in.
// Our own data renders unsanitized, the same posture as before.
import { marked } from 'marked'

marked.use({ gfm: true, breaks: true })

export let md = (s: string): string => marked.parse(s) as string
