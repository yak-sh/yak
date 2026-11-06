// Connected agents render as status rows or compact launch links. Each
// shape shares its server markup with the browser's refresh template; pages
// without a list still refresh prompts without touching surrounding inputs.
// The rows are @yaks/ui's (Card, Rows, State, Button, Icon), drawn by the
// pencil skin.
import { Button, Card, Icon, Rows, State } from '@yaks/ui/parts'
import { h } from 'preact'
import type { Agent, Brand } from './connected.ts'
import { icons } from './icons.ts'

let destinations: Partial<Record<Brand, { href: string; label: string }>> = {
  chatgpt: { href: 'https://chatgpt.com/', label: 'Open ChatGPT' },
  claude: { href: 'https://claude.ai/new', label: 'Open Claude' },
}

let hidden = (name: string, value: string, more = {}) =>
  h('input', { type: 'hidden', name, ...more, value })

// A row's way out: it revokes what the row stands for and comes back to
// `back` (identity.ts answers the post).
let disconnect = (agent: Agent | undefined, back: string) =>
  h(
    'form',
    { method: 'post', action: '/oauth/agents/disconnect' },
    hidden('agent', agent?.id ?? '', { 'data-agent-id': '' }),
    hidden('return', back),
    h(Button, {
      type: 'submit',
      'data-agent-disconnect': '',
      'aria-label': `Disconnect ${agent?.name ?? ''}`,
    }, 'Disconnect'),
  )

let row = (agent?: Agent, links = false, back = '') => {
  let link = agent?.brand &&
      Object.hasOwn(destinations, agent.brand)
    ? destinations[agent.brand]
    : undefined
  if (links && agent && !link) return null
  let open = h(
    'a',
    {
      class: 'Agents_Open',
      'data-agent-open': '',
      href: link?.href,
      hidden: !link,
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    h('span', { 'data-agent-action': '' }, link?.label ?? ''),
    h(Icon, { of: icons['external-link'] }),
  )
  return links ? h('li', null, open) : h(
    Rows.Item,
    { as: 'li' },
    h(
      Rows.Main,
      null,
      h(Rows.Name, { 'data-agent-name': '' }, agent?.name ?? ''),
      h(State, { mod: 'positive' }, 'Connected'),
    ),
    h(Rows.Actions, null, open, disconnect(agent, back)),
  )
}

/**
 * The connected agents as a card of rows, each with its Disconnect button
 * returning to `back`, or as launch links. Links leave out an agent with no
 * web destination (Claude Code, Cursor, the CLI), and a list with nothing in
 * it hides, its card with it, so the page around it says what to do next.
 */
export let agentList = (
  agents: Agent[],
  view: 'rows' | 'links' = 'rows',
  back = '',
) => {
  let links = view == 'links'
  let rows = agents.map((c) => row(c, links, back)).filter(Boolean)
  let list = h(
    links ? 'ul' : Rows,
    {
      ...(links
        ? { class: 'Agents Agents-links' }
        : { as: 'ul', class: 'Agents' }),
      'aria-label': 'Connected agents',
      hidden: !rows.length,
    },
    rows,
  )
  let template = h(
    'template',
    { 'data-agent-row': '' },
    row(undefined, links, back),
  )
  // Links sit bare in what holds them; rows are a card of their own.
  return h(
    links ? 'div' : Card,
    {
      ...(links
        ? { 'data-agent-links': '' }
        : { 'data-connected': '', hidden: !rows.length }),
      'data-agents': '',
      'aria-live': 'polite',
    },
    links ? null : h(Card.Head, null, h(Card.Title, null, 'Connected agents')),
    list,
    template,
  )
}

/** What keeps the list current while the page is open: on focus and on
 * coming back to the tab, the agents are asked for again and each row the
 * template draws replaces one that changed. */
export let agentLive = (endpoint: string) =>
  h('script', {
    dangerouslySetInnerHTML: {
      __html: `(()=>{
let root=document.querySelector('[data-agents]');
let links=root?.hasAttribute('data-agent-links');
let list=root?.querySelector('.Agents');
let template=root?.querySelector('[data-agent-row]');
let disconnected=document.querySelector('[data-disconnected]');
if(!list&&!disconnected)return;
let destinations=${JSON.stringify(destinations)};
let busy=false;
let refresh=async()=>{
  if(busy||document.hidden)return;
  busy=true;
  try{
    let response=await fetch(${
        JSON.stringify(endpoint).replaceAll('<', '\\u003c')
      },{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}});
    if(!response.ok)return;
    let data=await response.json();
    if(!Array.isArray(data.agents)||!data.agents.every(c=>c&&typeof c.name==='string'&&typeof c.id==='string'))return;
    if(list&&template){
      let rows=document.createDocumentFragment();
      for(let agent of data.agents){
        let destination=Object.hasOwn(destinations,agent.brand)?destinations[agent.brand]:null;
        if(links&&!destination)continue;
        let row=template.content.firstElementChild.cloneNode(true);
        let name=row.querySelector('[data-agent-name]');
        if(name)name.textContent=agent.name;
        row.querySelector('[data-agent-id]')?.setAttribute('value',agent.id);
        row.querySelector('[data-agent-disconnect]')?.setAttribute('aria-label','Disconnect '+agent.name);
        let link=row.querySelector('[data-agent-open]');
        if(destination){
          link.href=destination.href;
          link.hidden=false;
          link.querySelector('[data-agent-action]').textContent=destination.label;
        }
        rows.append(row);
      }
      if(list.children.length!==rows.children.length||[...list.children].some((row,i)=>!row.isEqualNode(rows.children[i])))list.replaceChildren(rows);
      list.hidden=!list.children.length;
    }
    let any=data.agents.length>0;
    document.querySelectorAll('[data-connected]').forEach(el=>{el.hidden=!any});
    document.querySelectorAll('[data-disconnected]').forEach(el=>{el.hidden=any});
  }catch{}finally{busy=false}
};
window.addEventListener('focus',refresh);
document.addEventListener('visibilitychange',refresh);
})();`,
    },
  })
