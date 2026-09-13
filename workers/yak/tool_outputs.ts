/** Structured result contracts for the fixed public MCP tool roster.
 * Text-only operations expose their existing narrative as `text`; domain
 * results retain the fields consumed by app views, alongside that narrative.
 */
import { z } from 'zod'

const text = z.string().describe(
  'Human-readable result, including any warnings or next steps.',
)
const object = (fields: z.ZodRawShape) => z.object(fields).passthrough()
const strings = z.array(z.string())
const count = z.number()
const record = object({ type: z.string(), name: z.string(), value: z.string() })
const step = object({
  step: z.enum(['dns', 'validation', 'certificate']),
  state: z.enum(['done', 'waiting', 'error']),
  said: z.string(),
})
const domain = object({
  hostname: z.string(),
  serves: z.string(),
  url: z.string(),
  stage: z.string(),
  apex: z.boolean(),
  records: z.array(record),
  steps: z.array(step),
})
const meter = object({
  month: z.string(),
  requests: count,
  bytes: count,
  rows_read: count.optional(),
  rows_written: count.optional(),
  files: count.optional(),
  emails: count.optional(),
  builds: count.optional(),
  tokens: count.optional(),
  seconds: count.optional(),
  built: count.optional(),
  at: z.string().optional(),
})
const app = object({
  slug: z.string(),
  title: z.string(),
  url: z.string(),
  mail: z.string(),
  version: count,
  errors: count,
  usage: meter.nullable(),
  home: z.boolean().optional(),
  bindings: z.array(
    object({ name: z.string(), type: z.string(), resource: z.string() }),
  ),
})
const space = object({
  slug: z.string(),
  title: z.string(),
  url: z.string(),
  role: z.string(),
  apps: z.array(app),
  trash: z.array(object({ slug: z.string(), title: z.string(), days: count })),
  tier: z.string(),
  usage: meter,
  ceilings: object({
    apps: count.nullable().optional(),
    requests: count.optional(),
    bytes: count.optional(),
    files: count,
    emails: count,
    builds: count,
  }),
})
const command = object({
  at: z.string(),
  name: z.string(),
  description: z.string(),
  input: z.record(z.unknown()).describe(
    'Input JSON Schema declared by the app.',
  ),
})
const error = object({
  eids: strings,
  app: z.string(),
  message: z.string(),
  where: z.string(),
  version: count.nullable(),
  count,
  at: z.string(),
})

const fields: Record<string, z.ZodRawShape> = {
  app_list: { spaces: z.array(space).optional() },
  commands: { commands: z.array(command).optional() },
  app_errors: {
    space: z.string().optional(),
    app: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
    version: count.optional(),
    errors: z.array(error).optional(),
  },
  domain_attach: domain.shape,
  domain_status: { domains: z.array(domain).optional() },
  // `command` dispatches app-defined query/apply operations. Rows depend on
  // the app vocabulary; do not manufacture a fixed shape for their fields.
  command: {
    rows: z.array(z.record(z.unknown())).optional().describe(
      'Query results in the app vocabulary.',
    ),
    entities: strings.optional(),
    aliases: z.record(z.string()).optional(),
  },
  app_stats: {
    on: z.boolean(),
    space: z.string().optional(),
    app: z.string().optional(),
    url: z.string().optional(),
    days: count.optional(),
    total: count.optional(),
    daily: z.array(object({ day: z.string(), views: count })).optional(),
    pages: z.array(object({ name: z.string(), views: count })).optional(),
    from: z.array(object({ name: z.string(), views: count })).optional(),
    countries: z.array(object({ name: z.string(), views: count })).optional(),
  },
}

/** All narrative tools have a concrete text contract, not an empty object. */
export const platformOutput = (
  name: string,
): z.ZodObject<z.ZodRawShape, 'passthrough'> =>
  object({ ...fields[name], text })

/** Preserve existing unwrapped view fields and make prose available structurally. */
export const structuredOutput = (
  message: string,
  data?: unknown,
): Record<string, unknown> => {
  if (data != null && (typeof data !== 'object' || Array.isArray(data))) {
    throw new Error('Platform tool data must be an object')
  }
  return { ...data as Record<string, unknown> | undefined, text: message }
}
