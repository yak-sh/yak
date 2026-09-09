// Native Session work eligibility, shared by the runner and the stop-request
// write gate. A cancellation closes its generation's input window as well as
// its tool loop; only input appended after that boundary can resume the turn.
import type { Sql } from './store/sql.ts'

let inputEdge = (generation: string, through: string, seq: string) =>
  `max(
    coalesce((select t.seq from entry t where t.entity = ${through}), ${seq}),
    coalesce((select max(ce.seq) from cancel z join entry ce on ce.entity = z.entity
              where z.target = ${generation}), 0)
  )`

export let pendingAttention = (db: Sql, session: string) =>
  !!db.prepare(
    `select 1 from entry a join attention n on n.entity = a.entity
     where a.session = (select id from entity where eid = ?) and not exists (
       select 1 from entry e join generation g on g.entity = e.entity
       where e.session = a.session
         and a.seq <= ${inputEdge('e.entity', 'g.through', 'e.seq')}
     ) limit 1`,
  ).get(session)

export let advanceable = (db: Sql, session?: string) =>
  db.prepare(`
    with latest as (
      select e.session, max(e.seq) as seq
      from generation g cross join entry e
      left join imported i on i.entity = g.entity
      where e.entity = g.entity and i.entity is null
        ${
    session ? 'and e.session = (select id from entity where eid = ?)' : ''
  }
      group by e.session
    ), current as (
      select e.session, e.entity as entity, e.seq, g.through,
             g.provider, g.model, g.effort
      from latest l
      join entry e on e.session = l.session and e.seq = l.seq
      join generation g on g.entity = e.entity
    )
    select (select eid from entity where id = c.session) as session,
           c.provider, c.model, c.effort,
           (select ee.eid from entry z join entity ee on ee.id = z.entity
            where z.session = c.session
            order by z.seq desc limit 1) as through
    from current c
    where not exists (select 1 from lease l where l.entity = c.entity)
      and (
        exists (select 1 from delivered d where d.entity = c.entity)
        or exists (select 1 from error x where x.entity = c.entity)
        or exists (select 1 from cancel z where z.target = c.entity)
      )
      and not exists (
        select 1 from output o join call k on k.entity = o.entity
        where o.source = c.entity
          and not exists (select 1 from result r where r.call = k.entity)
          and not exists (select 1 from error x where x.entity = k.entity)
          and not exists (select 1 from cancel z where z.target = k.entity)
      )
      and (
        exists (
          select 1 from entry n
          where n.session = c.session
            and n.seq > ${inputEdge('c.entity', 'c.through', 'c.seq')}
            and (
              exists (select 1 from attention a where a.entity = n.entity)
              or (
                exists (select 1 from message m
                        where m.entity = n.entity and m.role = 'user')
                and not exists (select 1 from output o where o.entity = n.entity)
              )
            )
        )
        or (
          not exists (select 1 from error x where x.entity = c.entity)
          and not exists (select 1 from cancel z where z.target = c.entity)
          and exists (
            select 1 from output o join call k on k.entity = o.entity
            where o.source = c.entity
          )
        )
      )
    order by c.session
  `).all(...(session ? [session] : [])) as {
    session: string
    through: string
    provider: string
    model: string
    effort: string | null
  }[]
