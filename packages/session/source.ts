// The writer of a transcript line is independent of its turn role and actor.
import type { Bundle, Comp, Eid } from '@yaks/graph'

let comp = (b: Bundle, key: string) => (b[key] ?? {}) as Comp

/** A source stored on the message takes precedence over writer stamps.
 * Older transcripts retain their source through their structural components;
 * `created.by` records an actor, not necessarily the writer of the prose. */
export let source = (
  entry: Bundle,
  names: Map<Eid, string> = new Map(),
): string | undefined => {
  let explicit = comp(entry, 'entry').from
  if (typeof explicit == 'string' && explicit.trim()) return explicit
  if (entry.delivery) {
    let delivery = comp(entry, 'delivery')
    return delivery.outcome == 'stopped' || delivery.outcome == 'failed'
      ? 'the system'
      : `your helper (${delivery.child})`
  }
  if (entry.system || entry.woken || entry.attention || entry.tool_progress) {
    return 'the system'
  }
  if (entry.checkpoint) return 'the checkpoint summarizer'
  if (entry.prompt) {
    return comp(entry, 'prompt').source == 'delegation:instructions'
      ? 'your parent session'
      : 'the system'
  }
  if (comp(entry, 'notice').own) return 'your voice on the call'
  if (entry.notice || entry.task_context) return 'the system'
  if (entry.result || entry.output || entry.call) return undefined
  let { by, via } = comp(entry, 'created')
  let session = comp(entry, 'entry').session
  return (via != session && names.get(String(via))) ||
    names.get(String(by)) || (by ? `actor ${by}` : 'an unknown sender')
}

/** Host-rendered input prose and its writer, kept separate until assembly. */
export type InputText = string | { text: string; from?: string }
