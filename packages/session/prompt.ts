// UserPromptSubmit has prompt, prompt_id and transcript_path, but no sent
// timestamp: https://code.claude.com/docs/en/hooks#userpromptsubmit-input.
// Its exit-0 plain stdout is context. Never return a blocking decision.
// The transcript may lag the hook. Prefer a matching queued submission's
// timestamp; otherwise label the hook's clock as an observation, not a send.

type Row = Record<string, unknown>
let object = (value: unknown): Row =>
  value && typeof value == 'object' ? value as Row : {}
let stamp = (value: unknown): string =>
  typeof value == 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : ''

/** One line, without prompt text; a partial or malformed JSONL row is ignored.
 * Only end_turn finishes a reply: a tool-use block and a sidechain do not. */
export let promptTiming = (
  hook: Row,
  transcript: string,
  now: Date,
): string => {
  let ended = ''
  let sent = ''
  let queued = ''
  for (let line of transcript.split('\n')) {
    let row: Row
    try {
      row = object(JSON.parse(line))
    } catch {
      continue
    }
    if (row.isSidechain) continue
    let session = row.sessionId ?? row.session_id
    if (hook.session_id && session && session != hook.session_id) continue
    let at = stamp(row.timestamp)
    if (!at) continue
    let message = object(row.message)
    if (row.type == 'assistant' && message.stop_reason == 'end_turn') {
      ended = at
    }
    if (row.type == 'user') {
      // A previous copy of the same text is not this submission. Queue rows
      // before an already-recorded user turn have been consumed.
      if (hook.prompt_id && row.promptId == hook.prompt_id) sent = queued || at
      queued = ''
    }
    if (row.type == 'queue-operation' && row.operation == 'dequeue') queued = ''
    if (
      row.type == 'queue-operation' && row.operation == 'remove' &&
      row.content == hook.prompt
    ) queued = ''
    if (
      row.type == 'queue-operation' && row.operation == 'enqueue' &&
      typeof hook.prompt == 'string' && row.content == hook.prompt
    ) queued = at
  }
  let submitted = sent || queued
  return `${
    submitted
      ? `Prompt sent: ${submitted}`
      : `Prompt observed: ${now.toISOString()}`
  }; previous reply ended: ${ended || 'unknown'}.`
}

/** Best-effort local read, bounded even for a months-long session. Missing,
 * unreadable or non-file transcripts mean no context, never a failed prompt. */
export let promptContext = (hook: Row, now = new Date()): string => {
  if (typeof hook.transcript_path != 'string') return ''
  let file: Deno.FsFile | undefined
  try {
    // Check before opening so a FIFO cannot wedge the hook.
    if (!Deno.statSync(hook.transcript_path).isFile) return ''
    file = Deno.openSync(hook.transcript_path, { read: true })
    let size = file.statSync().size
    let start = Math.max(0, size - 1024 * 1024)
    file.seekSync(start, Deno.SeekMode.Start)
    let bytes = new Uint8Array(size - start)
    let read = 0
    while (read < bytes.length) {
      let n = file.readSync(bytes.subarray(read))
      if (n == null) break
      read += n
    }
    let text = new TextDecoder().decode(bytes.subarray(0, read))
    if (start) text = text.slice(text.indexOf('\n') + 1)
    return promptTiming(hook, text, now)
  } catch {
    return ''
  } finally {
    file?.close()
  }
}

/** Bad JSON is deliberately not an error at a hook boundary. */
export let promptHook = (value: unknown): Row | undefined => {
  try {
    let hook = object(JSON.parse(String(value)))
    return hook.hook_event_name == 'UserPromptSubmit' ? hook : undefined
  } catch {
    return undefined
  }
}
