// The vendored axe-core browser bundle checks WCAG 2.1 A and AA in the
// rendered document. Findings remain diagnostics, never a deploy restriction.
import axe from './vendor/axe.json' with { type: 'json' }

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
): Promise<Audit> => {
  await page.evaluate(axe.source)
  let result = await page.evaluate(`axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
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

export let report = ({ problems, review }: Audit) =>
  [
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
