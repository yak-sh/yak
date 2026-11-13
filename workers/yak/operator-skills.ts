// The skills a space keeps (D-160631): @yaks/persona's `skill{…}` rows with
// `doc{title, body}` and `content{body}`, in the space's Operator store beside
// its persona (operator-persona.ts). Its Operator is offered them as any
// session is (@yaks/harness `skillItems`, `skillRead`). A person's connected
// Claude is offered those of every space they write in, through @yaks/mcp's
// skills extension, beside the guide's pages.
import type { Bundle, Graph } from '@yaks/graph'
import type { SkillFiles } from '@yaks/mcp/skills'
import { writes } from '@yaks/member'
import { repoSkills } from '@yaks/persona/skills'
import { renderSkill } from '@yaks/persona/skill-text'
import { gather } from '@yaks/trial/round'
import { type Measured, measured } from '@yaks/trial/measured'
import { builderOf, SPACE } from './build-door.ts'
import { caught } from './defects.ts'
import { vouched, type Who } from './session.ts'
import { asCaller, type Ctx, refuse } from './tool.ts'
import type { Space } from './directory.ts'

/** The Builder's route answering {@link kept}. */
export let SKILLS = '/operator/skills'
/** The Builder's route answering one skill, by title ({@link skillNamed}). */
export let SKILL = '/operator/skill'
/** The Builder's route keeping a copy of a shared skill ({@link keepCopy}). */
export let KEEP = '/operator/skill/keep'
/** The Builder's route answering what a skill's rounds measured
 * ({@link results}), the kernel's to ask for its public page. */
export let RESULTS = '/skill/results'

// A skill's name as the Agent Skills format takes it, as @yaks/mcp checks
// it: one row that is not is left out of the listing rather than refusing
// all of them.
let NAME = /^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u

/** Each skill a store keeps, as its SKILL.md by path, read as `g` reads. */
export let kept = async (g: Graph): Promise<Record<string, string>> =>
  Object.fromEntries(
    (await repoSkills(g)).flatMap((b) => {
      let title = String((b.doc as { title: string }).title)
      let about = String((b.doc as { body?: string }).body ?? '')
      if (!NAME.test(title) || [...title].length > 64) return []
      if ([...about].length > 1024) return []
      return [[
        `${title}/SKILL.md`,
        renderSkill({ doc: b.doc, skill: b.skill, content: b.content }),
      ]]
    }),
  )

let encoder = new TextEncoder()

/**
 * The skills of every space the caller writes in, as one snapshot for
 * @yaks/mcp `attachSkills`: `.claude/skills/<space>/<title>/SKILL.md`. A space
 * whose Operator cannot answer is reported and left out.
 */
export let spaceSkills = async (ctx: Ctx): Promise<SkillFiles> => {
  let seats = (await ctx.dir.seats(ctx.person!))
    .filter((s) => writes(s.role) && !s.space.trashed)
  let each = await Promise.all(seats.map(async ({ space, role }) => {
    try {
      let answer = await builderOf(ctx.env, space.eid)(() =>
        new Request('https://builder' + SKILLS, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [SPACE]: space.eid,
            ...vouched(asCaller(ctx, role)),
          },
          body: '{}',
        })
      )
      if (!answer.ok) {
        throw new Error(`${SKILLS} answered ${answer.status}`)
      }
      let { files } = await answer.json() as { files: Record<string, string> }
      return Object.entries(files).map(([path, text]) =>
        [`.claude/skills/${space.slug}/${path}`, encoder.encode(text)] as const
      )
    } catch (error) {
      caught(error, { request: 'space skills', space: space.eid })
      return []
    }
  }))
  return { scope: 'spaces', files: new Map(each.flat()) }
}

/** A skill as one space shares it and another keeps it: its name, the line
 * saying when to use it, its instructions and its frontmatter. */
export type SkillText = {
  title: string
  description: string
  body: string
  skill: Record<string, unknown>
}

let textOf = (b: Bundle): SkillText => ({
  title: String((b.doc as { title?: string }).title ?? ''),
  description: String((b.doc as { body?: string }).body ?? ''),
  body: String((b.content as { body?: string } | undefined)?.body ?? ''),
  skill: (b.skill ?? {}) as Record<string, unknown>,
})

/** The skill a store keeps under `title`, or none. */
export let skillNamed = async (
  g: Graph,
  title: string,
): Promise<Bundle | undefined> =>
  (await repoSkills(g)).find((b) =>
    (b.doc as { title?: string }).title == title
  )

/** One skill's text, as `g` reads it, or null. */
export let skillText = async (g: Graph, title: string) => {
  let b = await skillNamed(g, title)
  return b
    ? {
      eid: b.entity.eid,
      ...textOf(b),
      installed: (b.installed ?? null) as
        | { of?: string; version?: number }
        | null,
    }
    : null
}

/** A shared skill's copy: its text and the offer and version it took. */
export type Copy = SkillText & { of: string; version: number }

/**
 * Keep a copy of a shared skill under its title: a new row, or the text of
 * the copy already kept from the same offer replaced, which is an update. A
 * skill of the space's own, or one copied from another offer, under the same
 * title is refused: a store keeps one skill per title. Answers the row and
 * the text it held before, if any.
 */
export let keepCopy = async (
  g: Graph,
  copy: Copy,
  by: string,
): Promise<{ eid: string; was: SkillText | null }> => {
  let held = await skillNamed(g, copy.title)
  let of = (held?.installed as { of?: string } | undefined)?.of
  if (held && of != copy.of) {
    throw refuse(
      'conflict',
      `this space already keeps a skill called ${copy.title} — install ` +
        'this one under another title (as: …)',
    )
  }
  let eid = held?.entity.eid ?? crypto.randomUUID()
  await g.apply([{
    entity: { eid },
    doc: { title: copy.title, body: copy.description },
    content: { body: copy.body },
    skill: copy.skill,
    installed: { of: copy.of, version: copy.version },
    $actor: { by },
  }], { trusted: true })
  return { eid, was: held ? textOf(held) : null }
}

/** Ask a space's Operator at one of its skill routes, as the caller with the
 * role they hold there. A refusal there is the caller's refusal. */
export let askSkills = async <T>(
  ctx: Ctx,
  space: Space,
  role: Who['role'],
  path: string,
  body: Record<string, unknown>,
): Promise<T> => {
  let answer = await builderOf(ctx.env, space.eid)(() =>
    new Request('https://builder' + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SPACE]: space.eid,
        ...vouched(asCaller(ctx, role)),
      },
      body: JSON.stringify(body),
    })
  )
  let said = await answer.json() as T & { code?: string; message?: string }
  if (!answer.ok) {
    if (said.code && said.message) throw refuse(said.code, said.message)
    throw new Error(`${path} answered ${answer.status}`)
  }
  return said
}

/**
 * What the rounds of the store's skill `skill` measured, oldest round first
 * (@yaks/trial/measured). Only the platform's own runs count: an attempt a
 * model wrote is one the space wrote (`created.by`, as the Operator writes
 * its own rows), never a row a person or their agent wrote in.
 */
export let results = async (
  g: Graph,
  skill: string,
  space: string,
): Promise<Measured[]> => {
  let rounds = await g.read(`.round.skill=${JSON.stringify(skill)} ?created`)
  let at = (b: Bundle) => String((b.created as { at?: string })?.at ?? '')
  let ran = (b: Bundle) => (b.created as { by?: string })?.by == space
  return await Promise.all(
    rounds.sort((a, b) => at(a).localeCompare(at(b))).map(async (r) =>
      measured(await gather(g, r.entity.eid), ran)
    ),
  )
}
