// Repository instructions are discovered by description, loaded by one tool,
// and scoped to the session's home without changing the graph or checkout.
import {
  argsOf,
  type Comp,
  type Eid,
  type Graph,
  Refused,
  who,
} from '@yaks/graph'
import type { Item } from '@yaks/model'
import type { Reply } from '@yaks/tools'
import type { Tool } from '@yaks/session'
import { loadSkill, skillsAt } from '@yaks/persona/skills'
import { graphTools } from './tools.ts'

let comp = (value: unknown): Comp =>
  value && typeof value == 'object' && !Array.isArray(value)
    ? value as Comp
    : {}

/** Read the session's workspace, never restoring or attaching a checkout. */
export let skillCwd = async (
  g: Graph,
  session: Eid,
  fallback?: string,
): Promise<string | undefined> => {
  let [owner] = await g.get([session])
  let home = comp(owner?.home)
  if (home.worktree) {
    let [tree] = await g.get([String(home.worktree)])
    let path = comp(tree?.worktree).path
    if (typeof path != 'string') {
      throw new Refused('Skill checkout is unavailable for this session')
    }
    return path
  }
  return typeof home.cwd == 'string' ? home.cwd : fallback
}

// A command directory can sit below its checkout. Supporting paths still
// belong to the skill directory under the repository root.
let skillRoot = async (cwd: string): Promise<string> => {
  let result = await new Deno.Command('git', {
    cwd,
    args: ['rev-parse', '--show-toplevel'],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) throw new Refused('Skill checkout is unavailable')
  return await Deno.realPath(new TextDecoder().decode(result.stdout).trim())
}

/** Provider-neutral context, refreshed for every ask after tool selection. */
export let skillItems = async (
  g: Graph,
  current: { session: Eid; tools: readonly Tool[] },
  fallback?: string,
): Promise<Item[]> => {
  if (!current.tools.some((tool) => tool.name == 'skill_read')) return []
  let cwd = await skillCwd(g, current.session, fallback)
  if (!cwd) return []
  let skills = (await skillsAt(g, cwd)).filter((skill) =>
    comp(skill.skill).invoke != 'user'
  )
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

/** Adapt the one loader through the shared graph runner for attribution. */
export let skillTools = (
  g: Graph,
  fallback?: string,
  reply?: Reply,
): Tool[] =>
  graphTools(g, {
    reply,
    tools: [{
      name: 'skill_read',
      description:
        'Load repository skill instructions by exact title after its description ' +
        'matches the work. Reads the session checkout without importing or ' +
        'executing anything; returns the supporting-file base path too.',
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
      run: async (call, graph) => {
        let session = who(call)?.by
        if (!session) throw new Refused('skill_read needs a session')
        let cwd = await skillCwd(graph, session, fallback)
        if (!cwd) throw new Refused('This session has no skill checkout')
        let skill = await loadSkill(graph, String(argsOf(call).skill), cwd)
        if (comp(skill.skill).invoke == 'user') {
          throw new Refused('This skill permits user invocation only')
        }
        let title = String(comp(skill.doc).title)
        let base = `${await skillRoot(cwd)}/.claude/skills/${title}`
        return [{
          entity: { eid: '$skill-location' },
          content: {
            body: `Skill ${title}; supporting files: ${base}\nMetadata: ` +
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
