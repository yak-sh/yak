// The ROSTER: the tool list a client cached at connect, named by a version it
// can be compared against, and the one line a reply carries when it has moved.
//
// A client lists the tools once, at `initialize`, and holds that list for the
// whole conversation. Everything after that is the server's problem: a tool
// added by a release, or by an app of the person's own, is a tool the agent
// cannot see and will not call, and a tool that went is one it calls into a
// refusal. `notifications/tools/list_changed` is the protocol's answer and is
// sent (stream.ts), but a client that holds no stream, or whose host ignores
// the notification, hears nothing — so the server says it again where the
// agent is certainly reading: on the next result.
//
// The version is a HASH of the names plus the release the server is running,
// so it moves when either does and is the same on every isolate of one deploy.
// The names are what the line names, because "the list moved" tells an agent
// nothing it can act on and "new: mail_send" tells it everything.

/** A stable name for one tool list: its names, and the release that served
 * them. Two servers of the same deploy listing the same tools agree; a tool
 * added, a tool gone, or a new release each move it. */
export let rosterVersion = (names: string[], mark = ''): string => {
  let said = [...names].sort().join(',') + '@' + mark
  let h = 0x811c9dc5
  for (let i = 0; i < said.length; i++) {
    h ^= said.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * The line a result carries when the roster moved under the client — naming
 * what moved, since an agent can act on a name and not on "something changed".
 * A release that moved no tool name moves the version and says nothing: there
 * is nothing for the agent to do about it.
 *
 * ```ts
 * rosterLine(['about'], ['about', 'mail_send'])
 * // 'The tool list changed since you connected (new: mail_send). …'
 * ```
 */
export let rosterLine = (
  was: string[],
  now: string[],
): string | undefined => {
  let fresh = now.filter((n) => !was.includes(n))
  let gone = was.filter((n) => !now.includes(n))
  if (!fresh.length && !gone.length) return undefined
  let said = [
    fresh.length ? `new: ${fresh.join(', ')}` : '',
    gone.length ? `gone: ${gone.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  return `The tool list changed since you connected (${said}). ` +
    'Reconnect to see them, or ask `about`.'
}
