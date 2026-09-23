// Whose fault an error is. A caller that named a property nobody declared, sent
// a stale precondition or asked for what it may not have is refused: that is
// the graph working, and it is answered, never reported. Anything else is a
// defect of ours. The line is drawn by the error's `name` alone, so a package
// joins the table by naming its error, without importing this one — and every
// door that has to decide (an HTTP answer, a tool call's recorded fault, what
// reaches an error tracker) reads the same table.

/** The HTTP status each error name answers with. Anything unlisted is a 500:
 * an error no package named is a bug in the server, not a fault of the
 * request. */
export let STATUS: Record<string, number> = {
  Refused: 400,
  Unsupported: 400,
  SyntaxError: 400,
  // @yaks/vocab's `Unknown`: a component or property name the vocabulary does
  // not define. The query named it, so the fault is the request's — and so is
  // its `Ambiguous`, a property name several components define where the query
  // did not say which one it meant. Both carry the name, and the ambiguous
  // one also carries the candidates.
  Unknown: 400,
  Ambiguous: 400,
  Unauthorized: 401,
  // The request is authenticated; the answer is still no. @yaks/member's
  // `Denied` is this, and so is any other policy refusal that uses that name.
  Denied: 403,
  NotFound: 404,
  Stale: 409,
}

/** The HTTP status an error answers with (default 500). Below 500 is the
 * caller's own no. */
export let status = (err: unknown): number =>
  (err instanceof Error ? STATUS[err.name] : undefined) ?? 500
