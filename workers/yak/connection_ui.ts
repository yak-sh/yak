// Connected chatbot rows share one server-rendered shape and a browser
// template. Refreshing this component leaves the surrounding forms intact.
import type { Connection, Provider } from './connections.ts'
import { esc } from './html.ts'
import { icon } from './icons.ts'

let destinations: Partial<Record<Provider, { href: string; label: string }>> = {
  chatgpt: { href: 'https://chatgpt.com/', label: 'Open ChatGPT' },
  claude: { href: 'https://claude.ai/new', label: 'Open Claude' },
}

let row = (connection?: Connection) => {
  let link = connection?.provider &&
      Object.hasOwn(destinations, connection.provider)
    ? destinations[connection.provider]
    : undefined
  return `<li class="Connections_Row">
<div class="Connections_Info"><strong data-connection-name>${
    esc(connection?.name ?? '')
  }</strong>
<span class="Connections_State">${icon('check')}Connected</span></div>
<a class="Connections_Open" data-connection-open${
    link ? ` href="${link.href}"` : ' hidden'
  } target="_blank" rel="noopener noreferrer"><span data-connection-action>${
    link?.label ?? ''
  }</span>${icon('external-link')}</a></li>`
}

export let connectionList = (connections: Connection[]) =>
  `<div data-connections aria-live="polite">
<ul class="Connections" aria-label="Connected chatbots" data-connected${
    connections.length ? '' : ' hidden'
  }>${connections.map(row).join('')}</ul>
<template data-connection-row>${row()}</template></div>`

export let connectionLive = (endpoint: string) =>
  `<script>(()=>{
let root=document.querySelector('[data-connections]');
if(!root)return;
let list=root.querySelector('.Connections');
let template=root.querySelector('[data-connection-row]');
let destinations=${JSON.stringify(destinations)};
let connected=!list.hidden, busy=false;
let refresh=async()=>{
  if(busy||document.hidden)return;
  busy=true;
  try{
    let response=await fetch(${
    JSON.stringify(endpoint).replaceAll('<', '\\u003c')
  },{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}});
    if(!response.ok)return;
    let data=await response.json();
    if(!Array.isArray(data.connections)||!data.connections.every(c=>c&&typeof c.name==='string'&&typeof c.id==='string'))return;
    let rows=document.createDocumentFragment();
    for(let connection of data.connections){
      let row=template.content.firstElementChild.cloneNode(true);
      row.querySelector('[data-connection-name]').textContent=connection.name;
      let link=row.querySelector('[data-connection-open]');
      let destination=Object.hasOwn(destinations,connection.provider)?destinations[connection.provider]:null;
      if(destination){
        link.href=destination.href;
        link.hidden=false;
        link.querySelector('[data-connection-action]').textContent=destination.label;
      }
      rows.append(row);
    }
    if(list.children.length!==rows.children.length||[...list.children].some((row,i)=>!row.isEqualNode(rows.children[i])))list.replaceChildren(rows);
    let any=data.connections.length>0;
    document.querySelectorAll('[data-connected]').forEach(el=>{el.hidden=!any});
    document.querySelectorAll('[data-disconnected]').forEach(el=>{el.hidden=any});
    if(any!==connected)document.querySelectorAll('details[data-connection-setup]').forEach(el=>{el.toggleAttribute('open',!any)});
    connected=any;
  }catch{}finally{busy=false}
};
window.addEventListener('focus',refresh);
document.addEventListener('visibilitychange',refresh);
})();</script>`
