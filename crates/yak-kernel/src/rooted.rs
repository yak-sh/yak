// Project-root reachability over the durable governed corpus. The recursive
// walk follows every dependency parent→child and uses UNION as its visited set,
// so cycles terminate without assigning structural meaning to any edge type.

use crate::vocab::vocab;
use rusqlite::Connection;

pub struct Reachability {
    pub reachable: Vec<String>,
    pub orphans: Vec<String>,
}

pub fn project_reachability(conn: &Connection) -> rusqlite::Result<Reachability> {
    let id_keyed =
        conn.prepare("select 1 from pragma_table_info('entity') where name = 'id'")?.exists([])?;
    let spine_key = if id_keyed { "id" } else { "eid" };
    let owner_col = if id_keyed { "entity" } else { "eid" };
    let corpus = vocab()
        .governed
        .iter()
        .map(|name| format!("select \"{owner_col}\" from \"{name}\""))
        .collect::<Vec<_>>()
        .join(" union ");
    let sql = format!(
        "with recursive rooted(entity) as (\
           select \"{owner_col}\" from project \
           union \
           select d.child from dependency d join rooted r on r.entity = d.parent\
         ), corpus(entity) as (\
           {corpus}\
         ) \
         select e.eid, 1 as reachable \
           from corpus c join rooted r on r.entity = c.entity \
           join entity e on e.\"{spine_key}\" = c.entity \
         union all \
         select e.eid, 0 as reachable \
           from corpus c join entity e on e.\"{spine_key}\" = c.entity \
          where not exists (select 1 from rooted r where r.entity = e.\"{spine_key}\") \
         order by eid"
    );
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    let mut reachable = vec![];
    let mut orphans = vec![];
    for row in rows {
        let (eid, rooted) = row?;
        if rooted != 0 {
            reachable.push(eid);
        } else {
            orphans.push(eid);
        }
    }
    Ok(Reachability { reachable, orphans })
}
