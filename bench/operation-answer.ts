/** A check's data findings do not make its timing fail. Refusals and command
 * failures still cannot earn a sample. */
import type { Bundle } from '@yaks/graph'
import { ailing } from '@yaks/tools/check'

type Answer = { result?: Bundle[]; content?: { text?: string }[] }
let parsed = (text: string): Answer => {
  try {
    return JSON.parse(text) ?? {}
  } catch {
    return {}
  }
}

/// fault('{"result":[{"entity":{"eid":"$fault"},"content":{"body":"no"}}]}') -> 'no'
/// fault('{"content":[{"type":"text","text":"no"}],"isError":true}') -> 'no'
/// fault(' plain words\n') -> 'plain words'
/** The fault in a CLI's JSON answer or a connector's text, else its words. */
export let fault = (text: string): string => {
  let said = parsed(text)
  let body = (Array.isArray(said.result) ? said.result : [])
    .find((b) => b.entity.eid == '$fault' || b.refusal)
    ?.content as { body?: string } | undefined
  return (body?.body ?? said.content?.[0]?.text ?? text).trim()
}

/** The CLI exits 1 for a check finding as well as a failed invocation. Only
 * the latter failed to perform the operation being measured. */
export let cliAnswer = (
  operation: { tool: string; command: string[] },
  code: number,
  text: string,
  stderr = '',
): string => {
  if (code == 0) return text
  let result = parsed(text).result
  if (
    code == 1 && Array.isArray(result) &&
    !result.some((b) => b.refusal || b.exception || b.entity.eid == '$fault') &&
    ailing({ verb: operation.command.at(-1) }, result)
  ) return text
  throw new Error(`${operation.tool}: ${fault(text) || fault(stderr)}`)
}
