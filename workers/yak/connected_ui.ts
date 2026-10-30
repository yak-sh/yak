// Connected agents render as status rows or compact launch links. Each
// shape shares its server markup with the browser's refresh template; pages
// without a list still refresh prompts without touching surrounding inputs.
import type { Agent, Brand } from './connected.ts'
import { esc } from './html.ts'
import { icon } from './icons.ts'

let destinations: Partial<Record<Brand, { href: string; label: string }>> = {
  chatgpt: { href: 'https://chatgpt.com/', label: 'Open ChatGPT' },
  claude: { href: 'https://claude.ai/new', label: 'Open Claude' },
}

// A row's way out: it revokes what the row stands for and comes back to
// `back` (identity.ts answers the post).
let disconnect = (agent: Agent | undefined, back: string) =>
  `<form method="post" action="/oauth/agents/disconnect">
<input type="hidden" name="agent" data-agent-id value="${esc(agent?.id ?? '')}">
<input type="hidden" name="return" value="${esc(back)}">
<button class="Button Button-quiet" type="submit" data-agent-disconnect aria-label="Disconnect ${
    esc(agent?.name ?? '')
  }">Disconnect</button></form>`

let row = (agent?: Agent, links = false, back = '') => {
  let link = agent?.brand &&
      Object.hasOwn(destinations, agent.brand)
    ? destinations[agent.brand]
    : undefined
  if (links && agent && !link) return ''
  let open = `<a class="Agents_Open" data-agent-open${
    link ? ` href="${link.href}"` : ' hidden'
  } target="_blank" rel="noopener noreferrer"><span data-agent-action>${
    link?.label ?? ''
  }</span>${icon('external-link')}</a>`
  return links ? `<li>${open}</li>` : `<li class="Rows_Item">
<div class="Rows_Main"><strong class="Rows_Name" data-agent-name>${
    esc(agent?.name ?? '')
  }</strong>
<span class="Status Status-good">Connected</span></div>
<div class="Rows_Actions">${open}${disconnect(agent, back)}</div></li>`
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
  let rows = agents.map((c) => row(c, links, back)).join('')
  let tag = links ? 'div' : 'section'
  return `<${tag} ${
    links
      ? 'data-agent-links'
      : `class="Card" data-connected${rows ? '' : ' hidden'}`
  } data-agents aria-live="polite">${
    links
      ? ''
      : '<header class="Card_Head"><h2 class="Card_Title">Connected agents</h2></header>'
  }
<ul class="Agents ${
    links ? 'Agents-links' : 'Rows'
  }" aria-label="Connected agents"${rows ? '' : ' hidden'}>${rows}</ul>
<template data-agent-row>${row(undefined, links, back)}</template></${tag}>`
}

export let agentLive = (endpoint: string) =>
  `<script>(()=>{
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
})();</script>`
