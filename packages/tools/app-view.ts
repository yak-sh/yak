// What an MCP Apps view is served as: the type a host renders it under and
// the metadata saying which origins it may reach.

/**
 * The type a view is served under: text/html with the profile the MCP Apps
 * spec requires, which is how a host tells a page it renders from a page it
 * merely reads.
 */
export let VIEW_MIME = 'text/html;profile=mcp-app'

/**
 * The origins a view is allowed to reach, by what it reaches them for (MCP
 * Apps §Resource _meta): `connectDomains` is fetch and websockets,
 * `resourceDomains` is images, styles, scripts and fonts, `baseUriDomains` is
 * what a `<base href>` may name. Anything not listed is refused by the host's
 * own CSP, so an empty policy means a page that fetches nothing at all,
 * which is a declaration, not a gap.
 */
export type Csp = {
  connectDomains?: string[]
  resourceDomains?: string[]
  baseUriDomains?: string[]
}

/**
 * Resource metadata for both portable MCP Apps and ChatGPT, on resource
 * listings and read contents. `ui.domain` is optional and host-specific:
 * Claude expects a hashed hostname, while ChatGPT accepts a website origin,
 * so the OpenAI value is never copied into the portable field. The CSP lists
 * the network destinations; it does not set the sandbox origin.
 * https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
 * https://developers.openai.com/plugins/reference
 */
export let uiMeta = (domain: string, csp: Csp = {}) => ({
  ui: { csp },
  'openai/widgetDomain': domain,
  'openai/widgetCSP': {
    connect_domains: csp.connectDomains ?? [],
    resource_domains: csp.resourceDomains ?? [],
  },
})
