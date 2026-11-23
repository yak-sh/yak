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
  // not define, or a property named without its component. The query named
  // it, so the fault is the request's.
  Unknown: 400,
  Unauthorized: 401,
  // @yaks/embedding's: a provider that will not embed for this host until a
  // ceiling it set lifts, such as a space's spent model budget. The space's
  // limit answering, not a fault of ours.
  Withheld: 402,
  // The request is authenticated; the answer is still no. @yaks/member's
  // `Denied` is this, and so is any other policy refusal that uses that name.
  Denied: 403,
  // @yaks/member's: a component written again sooner than its pace lets this
  // writer. The same write is taken once the pace has run.
  Paced: 429,
  // @yaks/durable-object's: a statement refused because its object read or
  // wrote more rows than it may for now. The same call is taken once the
  // wait it names has run.
  Stopped: 429,
  NotFound: 404,
  Stale: 409,
  // @yaks/session's: a write naming a session that does not exist, or an
  // entity that is not the kind its property names, is the writer's mistake;
  // a take of a lock another session holds is a race lost, like a stale
  // precondition.
  UnknownSession: 400,
  Unnamed: 400,
  Bounced: 409,
  // @yaks/host/senders' `Unsent`: a service out in the world that did not
  // answer for now (slow, a 5xx, a 429). Neither the caller's fault nor ours:
  // the same call is taken later, so it is answered and retried, never
  // reported. Only a service that stays slow is, by whoever watches it.
  Unsent: 503,
}

/** The HTTP status an error answers with (default 500). Below 500 is the
 * caller's own no. */
export let status = (err: unknown): number =>
  (err instanceof Error ? STATUS[err.name] : undefined) ?? 500

/** Whether an error is a service that did not answer for now (status 503):
 * asked again later, and never a defect on its own. */
export let unheard = (err: unknown): boolean => status(err) == 503
