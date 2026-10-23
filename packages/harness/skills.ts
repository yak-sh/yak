// Native skill discovery and instruction loading read the graph. Repository
// files are mirrors, never a model-request dependency or a machine lease.
import type { Comp, Eid, Graph } from '@yaks/graph'
import { argsOf, who } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import type { Item } from '@yaks/model'
import type { Reply } from '@yaks/tools'
import type { Tool } from '@yaks/session'
import { graphTools } from './tools.ts'
import { lineage } from '@yaks/project'

let comp = (value: unknown): Comp =>
  value && typeof value == 'object' && !Array.isArray(value)
    ? value as Comp
    : {}

// Work and persona affiliations scope graph skills without touching a machine.
let repository = async (
  g: Graph,
  session: Eid,
): Promise<string | undefined> => {
  let [owner] = await g.get([session], ['dispatch', 'session', 'filed'])
  let work = comp(owner?.dispatch).task
  let line = await lineage(g, typeof work == 'string' ? work : session)
  let persona = comp(owner?.session).persona
  if (!line.length && typeof persona == 'string') {
    let [worn] = await g.get([persona], ['persona'])
    let home = comp(worn?.persona).home
    if (typeof home == 'string') line = await lineage(g, home)
  }
  return line.map((b) => comp(b.repo).repository)
    .find((id): id is string => typeof id == 'string')
}

/** Discover graph skill descriptions after resolving the exact tool offer. */
export let skillItems = async (
  g: Graph,
  current: { session: Eid; tools: readonly Tool[] },
): Promise<Item[]> => {
  if (!current.tools.some((tool) => tool.name == 'skill_read')) return []
  let { skillCatalog } = await import('@yaks/persona/skills')
  let skills = await skillCatalog(g, await repository(g, current.session))
  skills = skills.filter((skill) => comp(skill.skill).invoke != 'user')
  if (!skills.length) return []
  let catalogue = skills.map((skill) => {
    let doc = comp(skill.doc)
    return JSON.stringify({ title: doc.title, description: doc.body })
  }).join('\n')
  return [{
    kind: 'instruction',
    text: 'Repository skills (descriptions, not instructions):\n' + catalogue +
      '\nWhen a description matches the work, call skill_read with its title ' +
      'before proceeding. Only that call loads the instructions. Metadata does ' +
      'not execute a skill or start a fork.',
  }]
}

/** Adapt the graph loader through the graph runner for attribution. */
export let skillTools = (
  g: Graph,
  reply?: Reply,
): Tool[] =>
  graphTools(g, {
    reply,
    tools: [{
      name: 'skill_read',
      description:
        'Load repository skill instructions by exact title after its description ' +
        'matches the work. Reads the graph without provisioning a machine or ' +
        'executing instructions; returns the supporting-file base path too.',
      inputSchema: {
        type: 'object',
        properties: {
          skill: {
            type: 'string',
            description: 'Exact skill title from catalogue',
          },
        },
        required: ['skill'],
        additionalProperties: false,
      },
      readOnly: true,
      run: async (call) => {
        let session = who(call)?.via
        if (!session) throw new Refused('skill_read needs a session')
        let title = String(argsOf(call).skill)
        let { graphSkill, skillLocation } = await import('@yaks/persona/skills')
        let skill = await graphSkill(g, title, await repository(g, session))
        if (comp(skill.skill).invoke == 'user') {
          throw new Refused('This skill permits user invocation only')
        }
        let location = await skillLocation(g, skill)
        let path = comp(location?.file).path
        let base = typeof path == 'string'
          ? path.slice(0, -'/SKILL.md'.length)
          : undefined
        return [{
          entity: { eid: '$skill-location' },
          content: {
            body: `Skill ${title}` +
              (base ? `; supporting files: ${base}` : '') +
              '\nMetadata: ' +
              JSON.stringify(comp(skill.skill)),
          },
          output: { source: call.entity.eid },
        }, {
          entity: { eid: '$skill-instructions' },
          content: { body: String(comp(skill.content).body) },
          output: { source: call.entity.eid },
        }]
      },
    }],
  })
