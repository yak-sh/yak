// The skills a space keeps (D-160631): @yaks/persona's `skill{…}` rows with
// `doc{title, body}` and `content{body}`, in the space's Operator store beside
// its persona (operator-persona.ts). Its Operator is offered them as any
// session is (@yaks/harness `skillItems`, `skillRead`). A person's connected
// Claude is offered those of every space they write in, through @yaks/mcp's
// skills extension, beside the guide's pages.
import type { Graph } from '@yaks/graph'
import type { SkillFiles } from '@yaks/mcp/skills'
import { writes } from '@yaks/member'
import { repoSkills } from '@yaks/persona/skills'
import { renderSkill } from '@yaks/persona/skill-text'
import { builderOf, SPACE } from './build-door.ts'
import { caught } from './defects.ts'
import { vouched } from './session.ts'
import { asCaller, type Ctx } from './tool.ts'

/** The Builder's route answering {@link kept}. */
export let SKILLS = '/operator/skills'

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
