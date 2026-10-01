/// <reference lib="deno.ns" />
// One immutable, explicitly scoped skill snapshot per MCP server. Resource
// reads discover bytes; only an explicit prompt retrieval loads instructions.
import {
  fromJsonSchema,
  type JsonSchemaType,
  type McpServer,
  ProtocolError,
  ResourceTemplate,
} from '@modelcontextprotocol/server'
import { DefaultJsonSchemaValidator } from '@modelcontextprotocol/server/_shims'
import { type Bundle, type Graph, Refused } from '@yaks/graph'
import { repoSkills, skillFiles } from '@yaks/persona/skills'
import { renderSkill } from '@yaks/persona/skill-text'
import { parse, YamlSyntaxError } from '@std/yaml'

export type SkillOptions = { graph: Graph; repository?: string; cwd?: string }
type File = { uri: string; bytes: Uint8Array; text?: string; mimeType: string }
type Manifest = {
  uri: string
  frontmatter: Record<string, unknown>
  resources: { uri: string; digest: string; size: number }[]
}
type Snapshot = { skills: Manifest[]; files: Map<string, File> }
let encoder = new TextEncoder()
let cache = { ttlMs: 0, cacheScope: 'private' as const }
let invalid = (message: string): never => {
  throw new ProtocolError(-32602, message)
}
let safe = (path: string): boolean =>
  !/[\\:]/.test(path) &&
  [...path].every((char) =>
    char.charCodeAt(0) >= 32 && char.charCodeAt(0) != 127
  ) &&
  path.split('/').every((part) => part && part != '.' && part != '..')
let object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value == 'object' && !Array.isArray(value)
let metadata = (text: string, folder: string): Record<string, unknown> => {
  let match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) throw new Refused(`Skill ${folder} has no YAML frontmatter`)
  let value: unknown
  try {
    value = parse(match[1])
  } catch (error) {
    if (!(error instanceof YamlSyntaxError)) throw error
    throw new Refused(`Skill ${folder} has malformed YAML: ${error.message}`)
  }
  if (!object(value)) {
    throw new Refused(`Skill ${folder} has invalid frontmatter`)
  }
  let name = value.name
  let description = value.description
  if (
    typeof name != 'string' || [...name].length < 1 || [...name].length > 64 ||
    !/^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u.test(name) ||
    name != folder
  ) throw new Refused(`Skill ${folder} has a nonconforming Agent Skills name`)
  if (
    typeof description != 'string' || !description.trim() ||
    [...description].length > 1024
  ) throw new Refused(`Skill ${folder} has a nonconforming description`)
  return value
}
let decoded = (bytes: Uint8Array): string | undefined => {
  try {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    // Preserve BOM bytes as text too, so UTF8(text) equals the digest input.
    return bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf
      ? `\ufeff${text}`
      : text
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return undefined
  }
}
let mime = (path: string, text?: string): string => {
  if (text == undefined || text.includes('\0')) {
    return 'application/octet-stream'
  }
  if (path.endsWith('.md')) return 'text/markdown'
  if (path.endsWith('.json')) return 'application/json'
  return 'text/plain'
}
let base64 = (bytes: Uint8Array): string => {
  let parts: string[] = []
  for (let i = 0; i < bytes.length; i += 8192) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
  }
  return btoa(parts.join(''))
}
let digest = async (bytes: Uint8Array): Promise<string> => {
  let hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)),
  )
  return 'sha256:' +
    [...hash].map((b) => b.toString(16).padStart(2, '0')).join('')
}
let document = (b: Bundle): string =>
  String((b.doc as { title?: string }).title)

let snapshot = async (options: SkillOptions): Promise<Snapshot> => {
  let bytes = new Map<string, Uint8Array>()
  let scope = options.repository ?? ''
  if (options.cwd != undefined) {
    let { localFiles } = await import('./skills-host.ts')
    let view = await localFiles(options.cwd)
    scope = view.scope
    bytes = view.files
  } else if (options.repository != undefined) {
    // Scope first; an unlinked or other repository skill cannot leak through.
    let skills = await repoSkills(options.graph, options.repository)
    let values = await skillFiles(options.graph, options.repository)
    for (let skill of skills) {
      values.set(
        `.claude/skills/${document(skill)}/SKILL.md`,
        renderSkill({
          doc: skill.doc,
          skill: skill.skill,
          content: skill.content,
        }),
      )
    }
    for (let [path, text] of values) bytes.set(path, encoder.encode(text))
  }
  let files = new Map<string, File>()
  let skills: Manifest[] = []
  let prefix = `skill://skills/${encodeURIComponent(scope)}/`
  let uri = (path: string): string =>
    prefix +
    path.slice('.claude/skills/'.length).split('/').map(encodeURIComponent)
      .join('/')
  for (let [path, raw] of [...bytes].sort(([a], [b]) => a.localeCompare(b))) {
    if (!safe(path) || !path.startsWith('.claude/skills/')) {
      throw new Refused(`Skill snapshot refuses unsafe path ${path}`)
    }
    let text = decoded(raw)
    let type = mime(path, text)
    files.set(uri(path), {
      uri: uri(path),
      bytes: raw,
      ...(type == 'application/octet-stream' ? {} : { text }),
      mimeType: type,
    })
  }
  for (let [path, raw] of [...bytes].sort(([a], [b]) => a.localeCompare(b))) {
    if (!path.endsWith('/SKILL.md')) continue
    let text = decoded(raw)
    if (text == undefined) {
      throw new Refused(`Skill document is not UTF8: ${path}`)
    }
    let parts = path.split('/')
    let frontmatter = metadata(text, parts.at(-2)!)
    let directory = path.slice(0, -'SKILL.md'.length)
    let members = [...bytes].filter(([path]) => path.startsWith(directory))
    if (
      members.length > 512 ||
      members.reduce((size, [, bytes]) => size + bytes.length, 0) >
        16 * 1024 * 1024
    ) {
      throw new Refused(
        `Skill ${frontmatter.name} exceeds manifest interoperability limits`,
      )
    }
    skills.push({
      uri: uri(path),
      frontmatter,
      resources: await Promise.all(members.map(async ([path, raw]) => ({
        uri: uri(path),
        digest: await digest(raw),
        size: raw.length,
      }))),
    })
  }
  // Only files covered by a complete manifest become resources. Orphan files
  // have no skill owner and are not a second repository-wide resource browser.
  let owned = new Set(skills.flatMap((s) => s.resources.map((r) => r.uri)))
  return {
    skills,
    files: new Map([...files].filter(([uri]) => owned.has(uri))),
  }
}

/** Attach before discovery/connection. No scope means an empty catalogue,
 * never all repositories. Each factory invocation sees one fresh snapshot. */
export let attachSkills = async (
  built: McpServer,
  options: SkillOptions,
): Promise<void> => {
  let view = await snapshot(options)
  let validator = new DefaultJsonSchemaValidator()
  let schema = (
    properties: JsonSchemaType['properties'],
    required: string[] = [],
  ) =>
    fromJsonSchema<Record<string, unknown>>({
      type: 'object',
      properties,
      required,
      additionalProperties: true,
    }, validator)
  built.server.registerCapabilities({
    resources: {},
    extensions: { 'io.modelcontextprotocol/skills': {} },
  })
  built.server.setRequestHandler('skills/list', {
    params: schema({ cursor: { type: 'string' }, _meta: { type: 'object' } }),
    result: schema({
      skills: { type: 'array' },
      nextCursor: { type: 'string' },
    }, ['skills']),
  }, (params) => {
    let cursor = params.cursor
    if (
      cursor != undefined &&
      (typeof cursor != 'string' || !/^\d+$/.test(cursor))
    ) {
      invalid('Invalid skill cursor')
    }
    let offset = cursor == undefined ? 0 : Number(cursor)
    if (!Number.isSafeInteger(offset) || offset > view.skills.length) {
      invalid('Invalid skill cursor')
    }
    let next = offset + 100
    return {
      skills: view.skills.slice(offset, next),
      ...(next < view.skills.length ? { nextCursor: String(next) } : {}),
      ...cache,
    }
  })
  built.server.setRequestHandler('skills/get', {
    params: schema({ uri: { type: 'string' }, _meta: { type: 'object' } }, [
      'uri',
    ]),
    result: schema({ skill: { type: 'object' } }, ['skill']),
  }, (params) => {
    let skill = view.skills.find((s) => s.uri == params.uri)
    if (!skill) invalid('Unknown skill URI')
    return { skill, ...cache }
  })
  for (let file of view.files.values()) {
    built.registerResource(file.uri, file.uri, {
      mimeType: file.mimeType,
      cacheHint: cache,
    }, () => ({
      contents: [{
        uri: file.uri,
        mimeType: file.mimeType,
        ...(file.text == undefined
          ? { blob: base64(file.bytes) }
          : { text: file.text }),
      }],
      ...cache,
    }))
  }
  // Unknown skill resources must be InvalidParams, without replacing resources
  // an extension already registered under another scheme/namespace.
  built.registerResource(
    'unknown-skill-resource',
    new ResourceTemplate(
      'skill://skills/{+path}',
      { list: undefined },
    ),
    {},
    () => invalid('Unknown skill resource URI'),
  )
  for (let skill of view.skills) {
    let invoke = skill.frontmatter['user-invocable']
    if (
      invoke === false ||
      ['false', 'no', 'off', '0'].includes(String(invoke).toLowerCase())
    ) continue
    let file = view.files.get(skill.uri)!
    built.registerPrompt(
      `skill:${
        new URL(skill.uri).pathname.split('/').slice(2, -1).map(
          decodeURIComponent,
        ).join('/')
      }`,
      {
        description: String(skill.frontmatter.description),
        _meta: { skillUri: skill.uri },
      },
      () => ({
        description: String(skill.frontmatter.description),
        messages: [{
          role: 'user',
          content: { type: 'text', text: file.text! },
        }],
        ...cache,
      }),
    )
  }
}
