// Historical refusal repair, not a rule for new errors. The migration owns
// reads and writes; this file only classifies audited old answers and returns
// a patch. Unknown evidence stops rehearsal rather than guessing from prose.
import type { Bundle, Comp } from '@yaks/graph'

/** Find selected answers only. Traversal in the second predicate filters, but
 * does not project reached calls into the candidate stream. Install refusal's
 * vocabulary before using these queries; the historical database lacks it. */
export let refusalFind = [
  '.error&?content&?output&?result&?imported&?refusal&?entry',
  '.result&.imported&!error&!refusal&.result.call.execution.state=failed&?content&?output',
]

let tools = new Set([
  'Ambiguous',
  'Bounced',
  'NotFound',
  'Refused',
  'Stale',
  'SyntaxError',
  'Unknown',
  'Unsupported',
  'arguments',
  'artifact',
  'children',
  'diverged',
  'id',
  'land',
  'mcp_tool',
  'not_a_reader',
  'not_found',
  'observability',
  'refused',
  'sentry',
  'session',
  'session_cap',
  'since',
  'task',
  'too_large',
  'value',
  'where',
])
let providers = new Set([
  'context_length_exceeded',
  'max_output_tokens',
  'usage_limit_reached',
  'no_credential',
])
// Findings and vault retry markers have their own later migrations. They are
// not refusals, even when their prose quotes a refused operation.
let retained = new Set(['transient', 'info', 'warn', 'error', 'fail'])
let failures = new Set([
  'exit',
  'transport',
  'server_error',
  'server_is_overloaded',
])

let comp = (row: Bundle, name: string): Comp | undefined => {
  let value = row[name]
  return value != null && typeof value == 'object' ? value : undefined
}
let text = (row: Bundle, name: string, prop: string) => {
  let value = comp(row, name)?.[prop]
  return typeof value == 'string' ? value : undefined
}
let unsafe: (row: Bundle, code: string) => never = (row, code) => {
  // Content, provider payloads and credential fragments never enter reports.
  throw new Error(
    `Unsafe historical refusal: eid=${row.entity.eid} code=${
      /^[\w.:-]{1,64}$/.test(code) ? code : 'unknown'
    }`,
  )
}
let httpRefusal = (code: string) =>
  /^http_4\d\d$/.test(code) && code != 'http_408'
let lost = (code: string) =>
  code == 'transport' || code == 'http_408' ||
  /^http_5\d\d$/.test(code)

/** A bounded source read for the row-only mover callback. Only native tool
 * refusals and imported failed results need call evidence; provider request
 * lines and genuine interruptions do not cause another read. */
export let refusalSource = (row: Bundle): string | undefined => {
  let code = text(row, 'error', 'code')
  let id = code != undefined && tools.has(code)
    ? text(row, 'output', 'source')
    : !row.error && row.result && row.imported && !row.refusal
    ? text(row, 'result', 'call')
    : undefined
  if (id == undefined) return undefined
  // References are eids, not query expressions. Refuse unsafe interpolation.
  if (!/^[\w:-]+$/.test(id)) unsafe(row, code ?? 'is_error')
  return `.eid=${id}&.fields=call.to,execution.state,imported.source`
}

let call = (
  row: Bundle,
  source: Bundle | undefined,
  id: string,
  code: string,
) => {
  if (!source || source.entity.eid != id || !text(source, 'call', 'to')) {
    unsafe(row, code)
  }
  return source
}

// These prefixes are actual historical wrappers, not substring searches. A
// 504 HTML body can contain 401 and an access-related 503 is still a failure.
let interrupted = (row: Bundle, body: string): string | undefined => {
  let message = body.replace(/^Response interrupted: ModelError: /, '')
  let attempts = /^Model request failed after [1-9]\d* attempts \(([\w]+)\): /
    .exec(message)
  if (attempts) {
    let code = attempts[1]
    let detail = message.slice(attempts[0].length)
    if (lost(code)) return undefined
    if (
      code == 'usage_limit_reached' &&
      /^responses: HTTP 429(?: —|$)/.test(detail)
    ) {
      return code
    }
    let http = /^responses: HTTP (\d{3})(?: —|$)/.exec(detail)
    if (httpRefusal(code) && http?.[1] == code.slice(5)) {
      return code
    }
    unsafe(row, 'interrupted')
  }
  // Direct messages require the full historical ModelError wrapper.
  if (body.startsWith('Response interrupted: ModelError: ')) {
    let http = /^responses: HTTP (\d{3})(?: —|$)/.exec(message)
    if (http) {
      let code = `http_${http[1]}`
      if (httpRefusal(code)) return code
      if (lost(code)) return undefined
      unsafe(row, 'interrupted')
    }
    if (message == 'responses: credential unavailable') return 'no_credential'
    if (
      /^responses: transport failed(?: —|$)/.test(message) ||
      message == 'responses: error reading a body from connection' ||
      /^responses: failed — (server_error|service_unavailable)$/.test(message)
    ) {
      return undefined
    }
  }
  if (
    body == 'Response interrupted.' ||
    body == 'Response interrupted: AbortError: The signal has been aborted'
  ) {
    return undefined
  }
  unsafe(row, 'interrupted')
}

/** Convert one audited historical answer, without mutating it or its source.
 * A supplied source must be the exact referenced call. Execution, attempt,
 * content, output.value and external raw errors are never copied into patches.
 * Unknown codes, payload-bearing error components, mismatched sources and
 * conflicting refusals fail with eid/code only. Existing $was guards survive. */
export let refusalPatch = (
  row: Bundle,
  source?: Bundle,
): Bundle | undefined => {
  let error = comp(row, 'error')
  let code = text(row, 'error', 'code')
  let body = text(row, 'content', 'body') ?? ''
  let refused: string | undefined
  if (row.error && !error) unsafe(row, 'unknown')
  if (error) {
    if (!code) unsafe(row, 'unknown')
    // The old kernel diagnostic had exactly these metadata fields. Retain
    // that shape before rejecting unrecognized payloads; never remove it.
    if (
      Object.keys(error).every((key) =>
        ['at', 'message', 'code'].includes(key)
      ) &&
      typeof error.message == 'string' && typeof error.at == 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
        .test(error.at)
    ) {
      return undefined
    }
    // Only our code-only component is removable. An external error object is
    // evidence, not a component this migration is entitled to discard.
    if (Object.keys(error).some((key) => key != 'code')) unsafe(row, code)
    if (retained.has(code)) return undefined
    if (tools.has(code)) {
      let id = text(row, 'output', 'source')
      if (id) call(row, source, id, code)
      else if (
        !(code == 'session' && /^Error: not a session: [\w-]+$/.test(body)) &&
        !(code == 'children' && /^Error: not your child: [\w-]+$/.test(body))
      ) {
        unsafe(row, code)
      }
      refused = code
    } else if (code == 'child_cap') {
      if (!/^Error: concurrent child cap \([1-9]\d*\) reached$/.test(body)) {
        unsafe(row, code)
      }
      refused = code
    } else if (providers.has(code) || httpRefusal(code)) {
      refused = code
    } else if (code == 'turn.failed') {
      if (
        !/^unexpected status 401 Unauthorized: Incorrect API key provided:/
          .test(body)
      ) {
        unsafe(row, code)
      }
      refused = 'http_401'
    } else if (code == 'interrupted') {
      // Tool runner interruption answers remain failures, regardless of any
      // provider-looking text quoted by the interrupted operation.
      if (text(row, 'output', 'source')) return undefined
      refused = interrupted(row, body)
    } else if (failures.has(code) || lost(code)) return undefined
    else unsafe(row, code)
  } else if (row.result && row.imported && !row.refusal) {
    let id = text(row, 'result', 'call')
    if (!id) unsafe(row, 'is_error')
    let sourceCall = call(row, source, id, 'is_error')
    if (
      text(sourceCall, 'execution', 'state') != 'failed' ||
      !text(row, 'imported', 'source') ||
      text(row, 'imported', 'source') != text(sourceCall, 'imported', 'source')
    ) {
      unsafe(row, 'is_error')
    }
    refused = 'is_error'
  }
  if (!refused) return undefined
  if (row.refusal && text(row, 'refusal', 'code') != refused) {
    unsafe(row, code ?? refused)
  }
  return {
    entity: { eid: row.entity.eid },
    ...(row.$was ? { $was: row.$was } : {}),
    ...(error ? { error: null } : {}),
    ...(!row.refusal ? { refusal: { code: refused } } : {}),
  }
}
