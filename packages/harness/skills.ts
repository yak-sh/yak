// Repository instructions are discovered by description and loaded on demand.
// A session with a machine reads that machine's files; a session without one
// discovers graph skills without asking a provider to provision anything.
import {
  argsOf,
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  Refused,
  who,
} from '@yaks/graph'
import type { Item } from '@yaks/model'
import type { Machine } from '@yaks/machine'
import type { Reply } from '@yaks/tools'
import type { Tool } from '@yaks/session'
import { parseSkill, repoSkills } from '@yaks/persona/skills'
import { graphTools } from './tools.ts'

export type SkillMachines = {
  machine(session: Eid): Promise<Machine>
  cwd(session: Eid): Promise<string | undefined>
}

let comp = (value: unknown): Comp =>
  value && typeof value == 'object' && !Array.isArray(value)
    ? value as Comp
    : {}

// Machine intentionally has only commands and files. Discovery goes through
// that door too, not a git process or filesystem borrowed from the host.
let listing = `p="$PWD"
while :; do
  if [ -e "$p/.git" ] || [ -d "$p/.claude" ]; then
    printf '%s\\n' "$p"
    if [ -d "$p/.claude/skills" ] && [ ! -L "$p/.claude" ] && [ ! -L "$p/.claude/skills" ]; then
      for dir in "$p"/.claude/skills/*; do
        [ -d "$dir" ] && [ ! -L "$dir" ] && [ -f "$dir/SKILL.md" ] && [ ! -L "$dir/SKILL.md" ] || continue
        printf '%s\\n' "\${dir##*/}"
      done
    fi
    break
  fi
  [ "$p" != / ] || break
  p="\${p%/*}"
  [ -n "$p" ] || p=/
done`

let files = async (
  machines: SkillMachines,
  session: Eid,
): Promise<{ root?: string; skills: Bundle[] }> => {
  let machine = await machines.machine(session)
  let cwd = await machines.cwd(session)
  let id = await machine.start(listing, cwd, undefined, session)
  for (;;) {
    let process = await machine.look(id)
    if (!process) throw new Refused('Skill discovery process is unavailable')
    if (process.exit) {
      if (process.exit.code != 0) {
        throw new Refused('Skill files are unavailable')
      }
      break
    }
    await new Promise((go) => setTimeout(go, machine.poll ?? 100))
  }
  let [root, ...titles] = await machine.tail(id, 100000)
  if (!root) return { skills: [] }
  let skills: Bundle[] = []
  for (let title of titles.sort()) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(title)) continue
    let path = `${root}/.claude/skills/${title}/SKILL.md`
    let source = await machine.read(path)
    let parsed: ReturnType<typeof parseSkill>
    try {
      parsed = parseSkill(source, title)
    } catch (error) {
      if (!(error instanceof Refused)) throw error
      throw new Refused(`Cannot load ${path}: ${String(error)}`)
    }
    skills.push({
      entity: { eid: `view:skill:${session}:${title}` },
      ...parsed,
    })
  }
  return { root, skills }
}

/** Descriptions refresh from the session's files after tool selection, without
 * provisioning a machine just to ask a model a question. */
export let skillItems = async (
  g: Graph,
  current: { session: Eid; tools: readonly Tool[] },
  machines: SkillMachines,
): Promise<Item[]> => {
  if (!current.tools.some((tool) => tool.name == 'skill_read')) return []
  let [owner] = await g.get([current.session])
  let home = comp(owner?.home)
  let [record] = home.machine
    ? await g.get([String(home.machine)], ['machine'])
    : []
  let state = comp(record?.machine).state
  let skills = state == 'running' || state == 'asleep'
    ? (await files(machines, current.session)).skills
    : await repoSkills(g)
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

/** Adapt the machine-file loader through the graph runner for attribution. */
export let skillTools = (
  g: Graph,
  machines: SkillMachines,
  reply?: Reply,
): Tool[] =>
  graphTools(g, {
    reply,
    tools: [{
      name: 'skill_read',
      description:
        'Load repository skill instructions by exact title after its description ' +
        'matches the work. Reads the session machine without importing or ' +
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
        let session = who(call)?.by
        if (!session) throw new Refused('skill_read needs a session')
        let { root, skills } = await files(machines, session)
        let title = String(argsOf(call).skill)
        let skill = skills.find((skill) => comp(skill.doc).title == title)
        if (!skill) throw new Refused(`No skill named ${title}`)
        if (comp(skill.skill).invoke == 'user') {
          throw new Refused('This skill permits user invocation only')
        }
        let base = `${root}/.claude/skills/${title}`
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
