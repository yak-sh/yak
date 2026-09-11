/** JSON Schema validation for portable tool arguments. Compiled once per schema. */
import { Ajv2020 } from 'ajv/dist/2020.js'

const ajv = new Ajv2020({ strict: false, allErrors: true, useDefaults: true })
const validators = new WeakMap<object, ReturnType<typeof ajv.compile>>()

export const validateToolInput = (
  tool: { inputSchema?: Record<string, unknown>; input?: object },
  args: Record<string, unknown>,
): Record<string, unknown> => {
  if (!tool.inputSchema) return args
  if (tool.input) {
    throw new Error('Tool cannot declare both input and inputSchema')
  }
  let validate = validators.get(tool.inputSchema)
  if (!validate) {
    validate = ajv.compile(tool.inputSchema)
    validators.set(tool.inputSchema, validate)
  }
  const value = structuredClone(args)
  if (!validate(value)) {
    throw new Error(
      'Invalid tool arguments: ' + ajv.errorsText(validate.errors),
    )
  }
  return value
}

/** Serializable tool metadata; independent of component declarations. */
export type ToolDefinition = {
  noun: string
  verb: string
  description: string
  name?: string
  title?: string
  inputSchema?: Record<string, unknown>
  options?: {
    positional?: readonly string[]
    short?: Readonly<Record<string, string>>
  }
  readOnly?: boolean
  destructive?: boolean
  idempotent?: boolean
  openWorld?: boolean
}

/** JSON Schema for tool declarations. Their location within vocab.json is not fixed. */
export const toolDefinitionSchema: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['noun', 'verb', 'description'],
  additionalProperties: false,
  properties: {
    noun: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    verb: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    name: { type: 'string', minLength: 1 },
    title: { type: 'string' },
    description: { type: 'string' },
    inputSchema: { type: 'object' },
    options: {
      type: 'object',
      additionalProperties: false,
      properties: {
        positional: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string' },
        },
        short: {
          type: 'object',
          propertyNames: { pattern: '^[a-zA-Z]$' },
          additionalProperties: { type: 'string' },
        },
      },
    },
    readOnly: { type: 'boolean' },
    destructive: { type: 'boolean' },
    idempotent: { type: 'boolean' },
    openWorld: { type: 'boolean' },
  },
}

export const toolDefinition = (value: unknown): ToolDefinition => {
  const candidate = validateToolInput(
    { inputSchema: toolDefinitionSchema },
    value as Record<string, unknown>,
  ) as unknown as ToolDefinition
  if (candidate.inputSchema) ajv.compile(candidate.inputSchema)
  const props = candidate.inputSchema?.properties as
    | Record<string, unknown>
    | undefined
  for (
    const field of [
      ...candidate.options?.positional ?? [],
      ...Object.values(candidate.options?.short ?? {}),
    ]
  ) {
    if (!props || !Object.hasOwn(props, field)) {
      throw new Error(`Option references unknown property: ${field}`)
    }
  }
  return candidate
}
