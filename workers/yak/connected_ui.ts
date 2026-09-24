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

let row = (agent?: Agent, links = false) => {
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
  return links ? `<li>${open}</li>` : `<li class="Agents_Row">
<div class="Agents_Info"><strong data-agent-name>${
    esc(agent?.name ?? '')
  }</strong>
<span class="Agents_State">${icon('check')}Connected</span></div>
${open}</li>`
}

export let agentList = (
  agents: Agent[],
  view: 'rows' | 'links' = 'rows',
) =>
  `<div data-agents${
    view == 'links' ? ' data-agent-links' : ''
  } aria-live="polite">
<ul class="Agents${
    view == 'links' ? ' Agents-links' : ''
  }" aria-label="Connected agents" data-connected${
    agents.length ? '' : ' hidden'
  }>${agents.map((c) => row(c, view == 'links')).join('')}</ul>
<template data-agent-row>${row(undefined, view == 'links')}</template></div>`

export let agentLive = (endpoint: string) =>
  `<script>(()=>{
let root=document.querySelector('[data-agents]');
let links=root?.hasAttribute('data-agent-links');
let list=root?.querySelector('.Agents');
let template=root?.querySelector('[data-agent-row]');
let disconnected=document.querySelector('[data-disconnected]');
if(!list&&!disconnected)return;
let destinations=${JSON.stringify(destinations)};
let connected=list?!list.hidden:disconnected.hidden, busy=false;
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
        let link=row.querySelector('[data-agent-open]');
        if(destination){
          link.href=destination.href;
          link.hidden=false;
          link.querySelector('[data-agent-action]').textContent=destination.label;
        }
        rows.append(row);
      }
      if(list.children.length!==rows.children.length||[...list.children].some((row,i)=>!row.isEqualNode(rows.children[i])))list.replaceChildren(rows);
    }
    let any=data.agents.length>0;
    document.querySelectorAll('[data-connected]').forEach(el=>{el.hidden=!any});
    document.querySelectorAll('[data-disconnected]').forEach(el=>{el.hidden=any});
    if(any!==connected)document.querySelectorAll('details[data-agent-setup]').forEach(el=>{el.toggleAttribute('open',!any)});
    connected=any;
  }catch{}finally{busy=false}
};
window.addEventListener('focus',refresh);
document.addEventListener('visibilitychange',refresh);
})();</script>`
