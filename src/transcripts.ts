// Interactive provider transcripts: the JSONL written by terminal sessions,
// normalized into the same rows as managed streams. Provider metadata stays
// compact; the raw event remains available behind the session log's seq.
import type { LogRow } from './types.ts'

type Event = Record<string, unknown>

let payload = (e: Event) => e.payload as Event | undefined

let words = (v: unknown): string =>
  Array.isArray(v)
    ? v.map(words).filter(Boolean).join('\n')
    : v && typeof v == 'object'
    ? words((v as Event).text ?? (v as Event).content)
    : String(v ?? '')

let short = (v: unknown): string => {
  let s = (typeof v == 'string' ? v : JSON.stringify(v) ?? '')
    .replace(/\s+/g, ' ').trim()
  return s.length > 140 ? `${s.slice(0, 140)}…` : s
}

let clock = (e: Event) => e.timestamp ? { at: String(e.timestamp) } : {}

let result = (p: Event): LogRow => {
  let out = p.output as Event | string | undefined
  let body = out && typeof out == 'object' ? out : undefined
  let detail = words(body?.content) || short(out)
  return {
    kind: 'tool',
    name: '↳',
    ...(body?.success == null ? {} : { ok: body.success !== false }),
    ...(detail ? { detail } : {}),
  }
}

let item = (p: Event): LogRow | null => {
  let type = String(p.type ?? '')
  if (type == 'message') return null
  if (type == 'reasoning') {
    let text = words(p.summary)
    return text ? { kind: 'reason', text } : { kind: 'sys', tag: 'thinking' }
  }
  if (type == 'custom_tool_call' || type == 'function_call') {
    return {
      kind: 'tool',
      name: String(p.name ?? ''),
      detail: short(p.input ?? p.arguments),
    }
  }
  if (type == 'custom_tool_call_output' || type == 'function_call_output') {
    return result(p)
  }
  if (type == 'agent_message') {
    return {
      kind: 'sys',
      tag: 'agent',
      text: [p.author, p.recipient].filter(Boolean).join(' → '),
    }
  }
  if (type == 'image_generation_call') {
    return {
      kind: 'tool',
      name: 'image_generation',
      ok: p.status != 'failed',
      detail: short(p.revised_prompt),
    }
  }
  return { kind: 'sys', tag: type || 'item' }
}

let message = (e: Event, p: Event): LogRow => {
  let type = String(p.type ?? '')
  if (type == 'user_message' || type == 'agent_message') {
    return {
      kind: 'say',
      role: type == 'user_message' ? 'user' : 'agent',
      text: String(p.message ?? ''),
      ...clock(e),
    }
  }
  if (type == 'task_complete') {
    return {
      kind: 'turn',
      ...(p.duration_ms == null ? {} : { ms: Number(p.duration_ms) }),
    }
  }
  if (type == 'turn_aborted') {
    return { kind: 'error', text: String(p.reason ?? 'turn aborted') }
  }
  if (type == 'patch_apply_end') {
    let n = Array.isArray(p.changes) ? p.changes.length : 0
    return {
      kind: 'tool',
      name: 'apply_patch',
      ok: p.success !== false,
      ...(n ? { detail: `${n} change${n == 1 ? '' : 's'}` } : {}),
      ...(p.stderr ? { error: short(p.stderr) } : {}),
    }
  }
  if (type == 'sub_agent_activity') {
    return {
      kind: 'sys',
      tag: 'agent',
      text: [p.kind, p.agent_path].filter(Boolean).join(' · '),
    }
  }
  return {
    kind: 'sys',
    tag: type == 'token_count'
      ? 'tokens'
      : type == 'task_started'
      ? 'turn'
      : type == 'context_compacted'
      ? 'compact'
      : type || 'event',
  }
}

export let codexTranscript = (e: Event): LogRow | null => {
  let p = payload(e)
  if (e.type == 'event_msg' && p) return message(e, p)
  if (e.type == 'response_item' && p) return item(p)
  if (e.type == 'session_meta') return { kind: 'sys', tag: 'session' }
  if (e.type == 'turn_context') return { kind: 'sys', tag: 'turn' }
  if (e.type == 'world_state') return { kind: 'sys', tag: 'state' }
  if (e.type == 'inter_agent_communication_metadata') {
    return { kind: 'sys', tag: 'agent' }
  }
  return null
}
