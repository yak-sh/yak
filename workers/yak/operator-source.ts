// Source references in model inputs, formatted once and removed before the
// conversation draws the person's words. This module also runs in the browser.
let BEFORE = '\n\nOriginal message text: message.txt (attachment '
let AFTER =
  '). Read its exact text with attachment_read inside code_mode, or write it into the sandbox with sandbox_write and attachment; do not retype it.'

export let sourceReference = (id: string) => BEFORE + id + AFTER

/** The exact final generated source note, never text merely quoting one. */
export let sourceId = (body: string) => {
  let at = body.lastIndexOf(BEFORE)
  if (at < 0) return undefined
  let id = body.slice(at + BEFORE.length, at + BEFORE.length + 64)
  return /^[0-9a-f]{64}$/.test(id) && body.slice(at) == sourceReference(id)
    ? id
    : undefined
}

/** Remove only the final generated note, preserving the original words. */
export let sourceWords = (body: string) =>
  sourceId(body) ? body.slice(0, body.lastIndexOf(BEFORE)) : body
