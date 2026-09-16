// An MCP exchange read as a call. A tools/call is the interesting traffic:
// which tool, whose session. initialize and tools/list are handshake noise and
// classify to nothing. A reply is an outcome: a protocol error and an isError
// result are the same disappointment from the caller's seat, so they count the
// same, and the first text block is the message worth keeping.

/** The tool and session a tools/call body names, or null for handshake noise. */
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

/** A JSON-RPC reply as ok-or-error. */
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
