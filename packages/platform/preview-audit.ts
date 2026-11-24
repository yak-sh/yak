// The vendored axe-core browser bundle checks WCAG 2.1 A and AA in the
// rendered document. Findings remain diagnostics, never a deploy restriction.
// The renderer supplies the browser script and runs it in the page.

/** axe-core's browser bundle and the version it reports. */
export type Axe = { source: string; version: string }

export type Finding = {
  rule: string
  element: string
  target: unknown[]
  fix: string
  impact: string | null
}
export type Audit = {
  engine: string
  standard: string
  problems: Finding[]
  review: Finding[]
}
/** What went away while DevTools was checking the rendered page. */
export type Interruption = 'target' | 'document'

/** An audit, or why the check could not finish. */
export type Checked = Audit | { interrupted: Interruption } | { failed: string }

/** A closed DevTools session or a document invalidated by navigation or closure. */
export let interruption = (error: unknown): Interruption | undefined => {
  // Puppeteer's protocol errors carry the raw Chrome reply in originalMessage.
  // Client-side closure has no reply, only the rewritten message.
  if (!(error instanceof Error) || !('originalMessage' in error)) return
  let reason = error.originalMessage ||
    error.message.replace(/^Protocol error \([\w.]+\): /, '')
  if (typeof reason != 'string') return
  if (
    reason == 'Target closed' || reason == 'Session with given id not found.' ||
    reason.startsWith('Session closed. Most likely the ')
  ) return 'target'
  if (
    reason == 'Execution context was destroyed.' ||
    reason == 'Cannot find context with specified id' ||
    reason == 'Inspected target navigated or closed'
  ) return 'document'
}
type Result = {
  violations: Violation[]
  incomplete: Violation[]
}
type Violation = {
  id: string
  help: string
  impact: string | null
  nodes: { html: string; target: unknown[] }[]
}

let findings = (rules: Violation[]) =>
  rules.flatMap((rule) =>
    rule.nodes.map((node) => ({
      rule: rule.id,
      element: node.html,
      target: node.target,
      fix: rule.help,
      impact: rule.impact,
    }))
  )

export let audit = async (
  page: { evaluate(expression: string): Promise<unknown> },
  axe: Axe,
): Promise<Audit> => {
  await page.evaluate(axe.source)
  let result = await page.evaluate(`axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    // Axe continues with the document when a stylesheet or media cannot load.
    preload: { assets: ['cssom', 'media'], timeout: 1500 },
    resultTypes: ['violations', 'incomplete']
  }).then(({ violations, incomplete }) => ({ violations, incomplete }))`) as Result
  return {
    engine: `axe-core ${axe.version}`,
    standard: 'WCAG 2.1 AA',
    problems: findings(result.violations),
    review: findings(result.incomplete),
  }
}

let line = (finding: Finding) =>
  `- ${finding.rule}: ${JSON.stringify(finding.target)} ${
    finding.element.replace(/\s+/g, ' ').slice(0, 180)
  } — ${finding.fix}`

export let report = (checked: Checked): string => {
  if ('interrupted' in checked) {
    let why = checked.interrupted == 'target'
      ? 'The browser closed or detached from the page.'
      : 'The page navigated or closed during the check.'
    return `Accessibility (WCAG 2.1 AA): the check was interrupted. ${why}`
  }
  if ('failed' in checked) {
    return `Accessibility (WCAG 2.1 AA): the check failed, so this preview has no accessibility report. ${checked.failed}`
  }
  let { problems, review } = checked
  return [
    `Accessibility (WCAG 2.1 AA): ${problems.length} problems; ${review.length} elements need manual review. Automated checks do not prove conformance.`,
    ...problems.slice(0, 30).map(line),
    ...(problems.length > 30
      ? [`${problems.length - 30} more problems in accessibility.problems.`]
      : []),
    ...review.slice(0, 5).map((finding) => `Review ${line(finding).slice(2)}`),
    ...(review.length > 5
      ? [`${review.length - 5} more elements in accessibility.review.`]
      : []),
  ].join('\n')
}
