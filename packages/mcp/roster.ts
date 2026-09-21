// The ROSTER: the tool list a client cached when it connected, identified by a
// version string it can be compared against, plus the one sentence a reply
// carries when the list has changed since.
//
// An MCP client lists the tools once, at `initialize`, and caches that list for
// the whole conversation. Everything after that is the server's problem: a tool
// a release added, or one an app of the person's own contributed, is a tool the
// agent cannot see and will not call, and a tool that was removed is one it
// calls and is refused. `notifications/tools/list_changed` is the protocol's
// answer, and a host holding an open stream should send it — but a client with
// no stream, or whose host ignores the notification, never hears it. So the
// server repeats it where the agent is certainly reading: in the next tool
// result.
//
// The version is a HASH of the tool names plus the server's release id, so it
// changes when either changes and is identical on every isolate of one deploy.
// The sentence names the tools that changed, because "the list changed" tells
// an agent nothing it can act on and "new: mail_send" tells it everything.

/** A stable version string for one tool list: its names, and the release that
 * served them. Two servers of the same deploy listing the same tools produce
 * the same string; a tool added, a tool removed, or a new release each change
 * it. */
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
 * The sentence a tool result carries when the roster changed after the client
 * cached it. It names the tools that came and went, since an agent can act on
 * a tool name and not on "something changed". A release that changed no tool
 * name changes the version but produces no sentence: there is nothing for the
 * agent to do about it.
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
