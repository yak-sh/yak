/** JSON Schema validation for portable tool arguments. Compiled once per schema. */
import { Ajv, type ValidateFunction } from 'ajv'
import { Ajv2019 } from 'ajv/dist/2019.js'
import { Ajv2020 } from 'ajv/dist/2020.js'

// Keep dialects in separate instances: 2020-12 changed tuple and ref semantics.
// Schemas without a declaration retain this package's 2020-12 default.
const dialects = (useDefaults: boolean) => {
  const options = {
    strict: false,
    allErrors: true,
    useDefaults,
    addUsedSchema: false,
  }
  const current = new Ajv2020(options)
  const draft7 = new Ajv(options)
  const draft2019 = new Ajv2019(options)
  return (schema: Record<string, unknown>) => {
    const uri = schema.$schema
    if (
      uri === undefined ||
      uri === 'https://json-schema.org/draft/2020-12/schema' ||
      uri === 'https://json-schema.org/draft/2020-12/schema#'
    ) return current
    if (
      uri === 'http://json-schema.org/draft-07/schema#' ||
      uri === 'http://json-schema.org/draft-07/schema'
    ) return draft7
    if (
      uri === 'https://json-schema.org/draft/2019-09/schema' ||
      uri === 'https://json-schema.org/draft/2019-09/schema#'
    ) return draft2019
    throw new Error('Unsupported tool JSON Schema dialect: ' + String(uri))
  }
}
const inputDialect = dialects(true)
const ajv = inputDialect({})
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
    validate = inputDialect(tool.inputSchema).compile(tool.inputSchema)
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

/** Validate the emitted object without applying defaults or changing the result. */
const outputDialect = dialects(false)
const outputAjv = outputDialect({})
const outputValidators = new WeakMap<
  object,
  ReturnType<typeof outputAjv.compile>
>()

/** Compile a non-mutating validator using the schema's declared dialect. */
export const toolOutputValidator = (
  schema: Record<string, unknown>,
): ValidateFunction => {
  let validate = outputValidators.get(schema)
  if (!validate) {
    validate = outputDialect(schema).compile(schema)
    outputValidators.set(schema, validate)
  }
  return validate
}

export const validateToolOutput = (
  tool: { outputSchema?: Record<string, unknown> },
  value: unknown,
): void => {
  if (!tool.outputSchema) return
  const validate = toolOutputValidator(tool.outputSchema)
  if (!validate(value)) {
    throw new Error(
      'Invalid tool result: ' + outputAjv.errorsText(validate.errors),
    )
  }
}

/** Serializable tool metadata; independent of component declarations. */
export type ToolDefinition = {
  noun: string
  verb: string
  description: string
  name?: string
  title?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
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
    outputSchema: { type: 'object' },
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
  if (candidate.inputSchema) {
    inputDialect(candidate.inputSchema).compile(candidate.inputSchema)
  }
  if (candidate.outputSchema) {
    outputDialect(candidate.outputSchema).compile(candidate.outputSchema)
  }
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
