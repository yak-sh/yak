// An MCP request and reply read as a call and its outcome. A `tools/call` is
// the traffic worth logging: which tool, and whose session. `initialize` and
// `tools/list` are protocol overhead and classify to nothing. In the reply, a
// JSON-RPC error and a result marked `isError` are the same failure from the
// caller's point of view, so they count the same, and the first text block is
// the message worth keeping.

/** The tool and session named by a `tools/call` request body, or null for a
 * request that is not one. */
export let toolCall = (
  body: unknown,
): { name: string; session_id: string | null } | null => {
  let b = body as {
    method?: string
    params?: { name?: string; arguments?: { session?: string } }
  }
  if (b?.method != 'tools/call' || !b.params?.name) return null
  return {
    name: String(b.params.name),
    session_id: b.params.arguments?.session ?? null,
  }
}

/** A JSON-RPC reply, read as success or failure. */
export let outcome = (
  reply: unknown,
): { ok: boolean; error: string | null } => {
  let r = reply as {
    error?: { message?: string }
    result?: { isError?: boolean; content?: { type?: string; text?: string }[] }
  }
  if (r?.error) return { ok: false, error: r.error.message ?? 'jsonrpc error' }
  if (r?.result?.isError) {
    let text = r.result.content?.find((c) => c.type == 'text')?.text
    return { ok: false, error: text || 'tool error' }
  }
  return { ok: true, error: null }
}
