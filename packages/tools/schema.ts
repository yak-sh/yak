// Public input and output schemas shared by tool catalogs and every transport.
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Schema, Tool } from '@yaks/graph'
import { toolName } from '@yaks/graph/call'
import { publicToolSchema } from '@yaks/vocab/tools'

// @yaks/graph leaves a tool's schemas opaque, because the core package depends
// on no validation library. This is where `Schema` gets a concrete meaning:
// the MCP SDK takes Zod, so a schema that is not a Zod schema throws at
// startup rather than producing a tool that lists the wrong arguments.
let zodOf = (
  tool: string,
  where: string,
  s: Schema | undefined,
): z.ZodTypeAny | undefined => {
  if (s == undefined) return undefined
  if (s instanceof z.ZodType) return s
  throw new Error(`${tool}: ${where} must be a Zod schema`)
}

/**
 * A tool's arguments as one Zod shape — its `input` object, with every schema
 * checked to be a Zod schema. This is what the server hands the MCP SDK, and
 * the starting point for anything that has to express a tool's arguments in
 * another format: a model's tool declaration takes JSON Schema, and
 * `z.object(shapeOf(tool))` is what you convert.
 */
export let shapeOf = (tool: Tool): Record<string, z.ZodTypeAny> =>
  Object.fromEntries(
    Object.entries(tool.input ?? {}).map((
      [name, s],
    ) => [name, zodOf(toolName(tool), `argument '${name}'`, s)!]),
  )

type Json = { [key: string]: unknown }
let isObj = (v: unknown): v is Json =>
  !!v && typeof v == 'object' && !Array.isArray(v)
let open = (v: unknown) => v === true || (isObj(v) && !Object.keys(v).length)

// A converted Zod schema, said in fewer words. zod-to-json-schema spells out
// what JSON Schema already assumes (an object open to more properties, an
// object naming none) and writes a nullable object or enum as an `anyOf`
// beside `{type: 'null'}`, which is a type list. Each says the same thing, on
// a listing every client is sent before it asks anything. Its draft-07 dialect
// line goes too: MCP
// reads a tool schema as 2020-12, which means the same for every keyword here.
let terse = (s: unknown): unknown => {
  if (!isObj(s)) return s
  let { anyOf, properties, items, additionalProperties, $schema: _, ...rest } =
    s
  let out: Json = { ...rest }
  if (isObj(properties) && Object.keys(properties).length) {
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([k, v]) => [k, terse(v)]),
    )
  }
  if (items !== undefined) out.items = terse(items)
  if (additionalProperties !== undefined && !open(additionalProperties)) {
    out.additionalProperties = terse(additionalProperties)
  }
  if (!Array.isArray(anyOf)) return out
  let kept = anyOf.map(terse)
  let one = kept.filter((k) => !(isObj(k) && k.type == 'null'))
  let [only] = one
  if (
    one.length == 1 && kept.length == 2 && isObj(only) &&
    typeof only.type == 'string' && !only.anyOf
  ) {
    return {
      ...only,
      type: [only.type, 'null'],
      ...(Array.isArray(only.enum) ? { enum: [...only.enum, null] } : {}),
      ...out,
    }
  }
  return { ...out, anyOf: kept }
}

/**
 * A tool's arguments as JSON Schema, whichever way it declared them: its own
 * `inputSchema`, or its Zod shape converted. This is exactly what
 * `tools/list` sends, so anything else that needs a tool's argument
 * grammar — a CLI mapping a command onto it, say — reads what an MCP client
 * reads.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { z } from 'zod'
 * import { inputSchemaOf } from '@yaks/tools/schema'
 *
 * let doc = z.object({ title: z.string().nullable().optional() }).passthrough()
 * let tool = {
 *   name: 'write',
 *   description: 'Write a doc',
 *   input: { doc: doc.nullable() },
 *   run: () => [],
 * }
 * assertEquals(inputSchemaOf(tool).properties, {
 *   doc: {
 *     type: ['object', 'null'],
 *     properties: { title: { type: ['string', 'null'] } },
 *   },
 * })
 * ```
 */
export let inputSchemaOf = (
  tool: Tool,
): { type: 'object'; [key: string]: unknown } =>
  publicToolSchema(
    tool.inputSchema ?? converted(tool),
  ) as { type: 'object'; [key: string]: unknown }

// A Zod input map converted once, shared by catalogs and transports.
let conversions = new WeakMap<object, Json>()
let converted = (tool: Tool): Json => {
  let held = tool.input && conversions.get(tool.input)
  if (held) return held
  let made = terse(zodToJsonSchema(z.object(shapeOf(tool)), {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  })) as Json
  if (tool.input) conversions.set(tool.input, made)
  return made
}

/**
 * The bundle answer for a door whose rows say words of their own beside their
 * components: {@link answerSchema}, with each of those words declared on the
 * row under its own schema. A client checks every answer against the schema
 * its tool is listed with, so a row word left undeclared reads to it as a
 * component that is not an object, and the whole answer is refused. yaks.app's
 * rows name what each entity is (`kind`), for one.
 */
export let answerWith = (
  words: Record<string, Json>,
): { type: 'object'; [key: string]: unknown } => ({
  type: 'object',
  properties: {
    result: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entity: {
            type: 'object',
            properties: { eid: { type: 'string' } },
            required: ['eid'],
          },
          ...words,
        },
        required: ['entity'],
        // The `$` sugars a bundle may wear beside its components — `$alias`,
        // the name a minted entity was asked for by, and the rest of
        // @yaks/graph's — are not components and are not objects, so they are
        // matched first and left open.
        patternProperties: { '^\\$': {} },
        additionalProperties: { type: ['object', 'null'] },
      },
    },
  },
  required: ['result'],
})

/**
 * The default output schema: returned bundles under `result`, shared by tool
 * discovery and transports that send structured answers.
 *
 * Every tool whose answer is entities answers this one shape, so it is written
 * once and listed on all of them, a plugin's tool included without declaring
 * anything; a tool whose answer is not entities declares its own
 * `outputSchema` (`graph_schema`, a vocabulary document). It says what a
 * bundle is and not what any component holds: a fully typed bundle is tens of
 * kilobytes of vocabulary, and `tools/list` would carry a copy per tool before
 * the agent has asked its first question. What a component holds is
 * `graph_schema`'s answer, asked for when it is wanted. It carries no prose
 * for the same reason: it rides on every tool, and `graph_apply`'s
 * description says what a bundle is once. A door whose rows carry words of
 * their own lists {@link answerWith} instead.
 */
export let answerSchema: { type: 'object'; [key: string]: unknown } =
  answerWith({})
