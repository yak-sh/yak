// What a transcript is told at its START, composed from every plugin that has
// something to say. A DIGEST is the prose a session reads before its first
// turn; a SECTION is one plugin's part of it, under its own heading.
//
// The seam lives here rather than in whichever package emits it, for the
// reason every facet's payload type lives with its mechanism: a contributor
// says what a section IS without importing the host that composes them, and
// without importing the plugin that will read them back. @yaks/session
// contributes what this transcript holds, @yaks/memory what is worth recalling
// and @yaks/goal what the work is for, and none of the three knows about the
// others.
//
// A plugin declares where its sections sit with a `weight` beside its factory
// — lower leads, and the config's order breaks a tie — so the owner's words
// come first and what the work is FOR comes last, whatever order the plugins
// were named in. That is all the coupling there is between them: a section is
// written from the transcript and the graph, never from another section.
//
// A section with no lines is not written. "Nothing claimed" is not news, and a
// heading over nothing is the noise a digest exists to avoid.

import type { ToolCtx } from '@yaks/graph'

/** One part of a digest: a heading, and the lines under it. */
export type Section = {
  /** the heading it is written under, without the `##` */
  heading: string
  /** the lines under it — empty means the section is not written at all */
  lines: string[]
}

/** How a section asks the graph: the same reader the call wanting the digest
 * was handed, so what a section may read is what its caller may read. */
export type Reading = ToolCtx['read']

/** The transcript a digest is for. Its eid is a `$alias` where nothing has
 * reified it yet, so a section that would query by it checks first. */
export type Subject = {
  entity: { eid: string; num?: number | null }
  [comp: string]: unknown
}

/** What a `./digest` facet's factory answers: this plugin's sections. */
export type Sections = (
  session: Subject,
  read: Reading,
) => Section[] | Promise<Section[]>

/** A composed digest: every plugin's sections, in weight order. */
export type Digest = (
  session: Subject,
  read: Reading,
) => Promise<Section[]>

/** One contributor, and where it sits. */
export type Part = { sections: Sections; weight?: number }

/**
 * The parts as one digest: every contributor's sections, in weight order, with
 * the empty ones left out.
 *
 * ```ts
 * // let told = composed([{ sections: mine, weight: -10 }, { sections: goals }])
 * ```
 */
export let composed = (parts: Part[]): Digest => async (session, read) => {
  let ordered = parts.toSorted((a, b) => (a.weight ?? 0) - (b.weight ?? 0))
  let written = await Promise.all(
    ordered.map((part) => part.sections(session, read)),
  )
  return written.flat().filter((s) => s.lines.length)
}

/** A digest as the lines a harness injects: a blank line, the heading, the
 * section. */
export let written = (sections: Section[]): string[] =>
  sections.flatMap((s) => ['', `## ${s.heading}`, ...s.lines])

/** One line, cut to a width a digest can afford. */
export let snip = (text: string, width = 120): string =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text
