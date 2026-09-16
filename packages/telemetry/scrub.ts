// Free text on its way in. A log is served to people and this one may be
// public, so text is cleaned when written, not when read: a fixed set of
// shapes that carry secrets or defeat cohorting are replaced, then the field is
// capped. The same normalization strips the variable bits that would otherwise
// fingerprint two identical crashes apart (see cohort.ts).

/** The longest a stored text field can be. */
export let CAP = 2048

/** Cut a string to {@link CAP}, marking the cut. */
export let clip = (s: string): string =>
  s.length > CAP ? s.slice(0, CAP - 1) + '…' : s

/**
 * Strip control bytes, home paths, URLs and high-entropy tokens (uuids, long
 * hex, long opaque runs), then clip. `null` stays `null`.
 */
export let scrub = (s: string | null | undefined): string | null =>
  s == null ? null : clip(
    s
      // deno-lint-ignore no-control-regex -- strip C0/DEL, keep \t and \n
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
      .replace(/(?:\/home\/|\/Users\/)[^/\s:]+/g, '~')
      .replace(/\b[a-z][\w+.-]*:\/\/[^\s'")\]]+/gi, '«url»')
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        '«id»',
      )
      .replace(/\b(?:0x)?[0-9a-f]{16,}\b/gi, '«hex»')
      .replace(/[A-Za-z0-9_-]{24,}/g, '«token»'),
  )
