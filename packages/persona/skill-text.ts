// A SKILL.md and its entity say the same thing: doc holds the folder name and
// description, content holds the instructions, and skill holds invocation and
// loading metadata. Only the frontmatter is interpreted here. The body is an
// opaque string: commands, file references and substitutions are never run.

import { parse, stringify, YamlSyntaxError } from '@std/yaml'
import { Refused } from '@yaks/graph'

/** The normalized parts of a skill, without an entity id or graph effects. */
export type SkillText = {
  doc: { title: string; body: string }
  content: { body: string }
  skill: {
    invoke: 'user' | 'model' | 'both'
    arguments: string[]
    paths: string[]
    fork: boolean
    options: Record<string, unknown>
  }
}

type SkillBundle = { doc?: unknown; content?: unknown; skill?: unknown }

let object = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) == Object.prototype ||
    Object.getPrototypeOf(value) == null)

let folder = (value: unknown): string => {
  if (typeof value != 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(value)) {
    throw new Refused('Unsafe skill folder name')
  }
  return value
}

let description = (value: unknown): string => {
  if (typeof value != 'string' || !value.trim()) {
    throw new Refused('Skill description must be a non-empty string')
  }
  return value
}

// Claude accepts these spellings as well as YAML booleans. Anything else is
// refused rather than turning a misspelled restriction into permission.
let boolean = (value: unknown, fallback: boolean, field: string): boolean => {
  if (value === undefined) return fallback
  if (typeof value == 'boolean') return value
  if (typeof value != 'string' && typeof value != 'number') {
    throw new Refused(`${field} must be a boolean`)
  }
  let word = String(value).toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(word)) return true
  if (['false', 'no', 'off', '0'].includes(word)) return false
  throw new Refused(`${field} must be a boolean`)
}

let strings = (value: unknown, field: string): string[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((v) => typeof v == 'string')) {
    throw new Refused(`${field} must be a string list`)
  }
  return [...value]
}

let list = (value: unknown, field: string, separator: RegExp): string[] =>
  typeof value == 'string'
    ? value.split(separator).map((v) => v.trim()).filter(Boolean)
    : strings(value, field)

let owned = new Set([
  'name',
  'description',
  'disable-model-invocation',
  'user-invocable',
  'arguments',
  'paths',
])

/** Decode frontmatter, retaining every byte after the closing delimiter's
 * line ending. An omitted name uses the folder; an explicit one must agree. */
export let parseSkill = (text: string, title: string): SkillText => {
  folder(title)
  let opening = /^---[\t ]*\r?\n/.exec(text)
  if (!opening) throw new Refused('Skill must start with YAML frontmatter')
  let rest = text.slice(opening[0].length)
  let closing = /^---[\t ]*(?:\r?\n|$)/m.exec(rest)
  if (!closing) throw new Refused('Skill frontmatter has no closing delimiter')
  let fields: unknown
  try {
    fields = parse(rest.slice(0, closing.index))
  } catch (error) {
    // YAML syntax is authored input. Anything else is an unexpected parser
    // failure and must reach the caller rather than look like a refusal.
    if (!(error instanceof YamlSyntaxError)) throw error
    throw new Refused(`Invalid skill frontmatter: ${error.message}`)
  }
  if (!object(fields)) throw new Refused('Skill frontmatter must be an object')
  if ('name' in fields && fields.name !== title) {
    throw new Refused('Skill frontmatter name must match its folder')
  }
  let body = description(fields.description)
  let model = !boolean(
    fields['disable-model-invocation'],
    false,
    'disable-model-invocation',
  )
  let user = boolean(fields['user-invocable'], true, 'user-invocable')
  // The vocabulary has no "neither" invocation mode. Losing either restriction
  // while importing would make an intentionally inaccessible skill callable.
  if (!model && !user) throw new Refused('Skill disables both invocation modes')
  let fork = fields.context === 'fork'
  let options = Object.fromEntries(
    Object.entries(fields).filter(([key]) =>
      !owned.has(key) && !(key == 'context' && fork)
    ),
  )
  return {
    doc: { title, body },
    content: { body: rest.slice(closing.index + closing[0].length) },
    skill: {
      invoke: model ? (user ? 'both' : 'model') : 'user',
      arguments: list(fields.arguments, 'arguments', /\s+/),
      paths: list(fields.paths, 'paths', /,/),
      fork,
      options,
    },
  }
}

/** Claude frontmatter from the entity's canonical fields. Unknown options
 * survive, but cannot override the name, description or invocation policy. */
export let frontmatter = (bundle: SkillBundle): Record<string, unknown> => {
  let doc = object(bundle.doc) ? bundle.doc : {}
  let title = folder(doc.title)
  let body = description(doc.body)
  if (!object(bundle.skill)) {
    throw new Refused('Skill component must be an object')
  }
  let skill = bundle.skill
  let invoke = skill.invoke === undefined ? 'both' : skill.invoke
  if (
    typeof invoke != 'string' || !['user', 'model', 'both'].includes(invoke)
  ) {
    throw new Refused('Skill invoke must be user, model or both')
  }
  let options = skill.options === undefined ? {} : skill.options
  if (!object(options)) throw new Refused('Skill options must be an object')
  let fork = skill.fork === undefined ? false : skill.fork
  if (typeof fork != 'boolean') {
    throw new Refused('Skill fork must be a boolean')
  }
  let fields: Record<string, unknown> = {
    name: title,
    description: body,
    ...Object.fromEntries(
      Object.entries(options).filter(([k]) => !owned.has(k)),
    ),
  }
  if (invoke == 'user') fields['disable-model-invocation'] = true
  if (invoke == 'model') fields['user-invocable'] = false
  let args = strings(skill.arguments, 'arguments')
  let paths = strings(skill.paths, 'paths')
  if (args.length) fields.arguments = args
  if (paths.length) fields.paths = paths
  if (fork) fields.context = 'fork'
  return fields
}

/** Serialize only the header; append the instructions without normalizing
 * whitespace, line endings, placeholders or a missing final newline. */
export let renderSkill = (bundle: SkillBundle): string => {
  let fields = frontmatter(bundle)
  if (bundle.content !== undefined && !object(bundle.content)) {
    throw new Refused('Skill content must be an object')
  }
  let body = object(bundle.content) ? bundle.content.body : ''
  if (typeof body != 'string') {
    throw new Refused('Skill content must be a string')
  }
  return `---\n${stringify(fields)}---\n${body}`
}
