// GENERATED — do not edit. Emitted by `deno task codegen` from the
// vocabulary manifests, whose source of truth is the annotated Rust
// contract in crates/xtask/src/contract. Refused by the gate stale
// check (`deno task codegen --check`). One contract, three faces:
// types.ts, fixture.json, and this module.

use crate::vocab::{PropType, Vocab};
use std::collections::HashMap;

pub(crate) fn baked() -> Vocab {
    let comps = vec![
        ("doc".into(), vec![
            ("title".into(), PropType::Text),
            ("body".into(), PropType::Body),
        ]),
        ("task".into(), vec![
            ("priority".into(), PropType::Priority),
            ("project".into(), PropType::Eid("project".into())),
            ("assignee".into(), PropType::Eid("entity".into())),
            ("domain".into(), PropType::Well("domains".into())),
        ]),
        ("accept".into(), vec![
            ("body".into(), PropType::Body),
        ]),
        ("project".into(), vec![
            ("color".into(), PropType::Text),
        ]),
        ("repo".into(), vec![
            ("path".into(), PropType::Text),
            ("url".into(), PropType::Url),
            ("base_branch".into(), PropType::Text),
            ("gate".into(), PropType::Text),
            ("push".into(), PropType::Bool),
        ]),
        ("venture".into(), vec![
            ("phase".into(), PropType::Enum(vec!["incubating".into(), "idea".into(), "building".into(), "launching".into(), "live".into(), "hold".into(), "paused".into(), "shuttered".into(), "killed".into()])),
            ("paused_from".into(), PropType::Enum(vec!["incubating".into(), "idea".into(), "building".into(), "launching".into(), "live".into(), "hold".into(), "paused".into(), "shuttered".into(), "killed".into()])),
            ("hold_from".into(), PropType::Enum(vec!["incubating".into(), "idea".into(), "building".into(), "launching".into(), "live".into(), "hold".into(), "paused".into(), "shuttered".into(), "killed".into()])),
            ("run_mode".into(), PropType::Enum(vec!["long-loop".into(), "cold".into(), "cron".into()])),
            ("agent_model".into(), PropType::Text),
            ("operated_by".into(), PropType::Text),
            ("tagline".into(), PropType::Text),
            ("site".into(), PropType::Url),
        ]),
        ("role".into(), vec![
            ("state".into(), PropType::Enum(vec!["running".into(), "stopped".into(), "paused".into(), "disabled".into(), "retired".into(), "held".into()])),
            ("surface".into(), PropType::Enum(vec!["native".into(), "managed".into()])),
            ("scope".into(), PropType::Eid("entity".into())),
            ("checkout".into(), PropType::Eid("entity".into())),
            ("schedule".into(), PropType::Text),
            ("wake_policy".into(), PropType::Enum(vec!["always".into(), "attention".into(), "scheduled".into(), "manual".into()])),
            ("wake_target".into(), PropType::Eid("entity".into())),
            ("retry_at".into(), PropType::Time),
            ("quiet".into(), PropType::Number),
            ("cooldown".into(), PropType::Number),
            ("cap".into(), PropType::Number),
        ]),
        ("board".into(), vec![
            ("query".into(), PropType::Query),
        ]),
        ("layout".into(), vec![
            ("root".into(), PropType::Eid("pane".into())),
        ]),
        ("pane".into(), vec![
            ("layout".into(), PropType::Eid("layout".into())),
            ("parent".into(), PropType::Eid("pane".into())),
            ("size".into(), PropType::Number),
            ("order".into(), PropType::Number),
            ("dir".into(), PropType::Enum(vec!["h".into(), "v".into()])),
            ("content".into(), PropType::Eid("entity".into())),
            ("view".into(), PropType::Text),
        ]),
        ("design".into(), vec![]),
        ("goal".into(), vec![
            ("scope".into(), PropType::Eid("project".into())),
        ]),
        ("architecture".into(), vec![]),
        ("canvas".into(), vec![]),
        ("web".into(), vec![
            ("url".into(), PropType::Url),
        ]),
        ("blob".into(), vec![
            ("bytes".into(), PropType::Number),
        ]),
        ("attachment".into(), vec![
            ("blob".into(), PropType::Eid("blob".into())),
            ("mime".into(), PropType::Text),
            ("name".into(), PropType::Text),
        ]),
        ("image".into(), vec![
            ("w".into(), PropType::Number),
            ("h".into(), PropType::Number),
        ]),
        ("card".into(), vec![
            ("target".into(), PropType::Eid("entity".into())),
            ("view".into(), PropType::Text),
        ]),
        ("pin".into(), vec![
            ("canvas".into(), PropType::Eid("entity".into())),
            ("x".into(), PropType::Number),
            ("y".into(), PropType::Number),
            ("w".into(), PropType::Number),
            ("h".into(), PropType::Number),
            ("z".into(), PropType::Number),
        ]),
        ("client".into(), vec![
            ("user_agent".into(), PropType::Text),
            ("actor".into(), PropType::Eid("entity".into())),
        ]),
        ("camera".into(), vec![
            ("client".into(), PropType::Eid("client".into())),
            ("canvas".into(), PropType::Eid("entity".into())),
            ("x".into(), PropType::Number),
            ("y".into(), PropType::Number),
            ("zoom".into(), PropType::Number),
            ("w".into(), PropType::Number),
            ("h".into(), PropType::Number),
        ]),
        ("fold".into(), vec![
            ("client".into(), PropType::Eid("client".into())),
            ("board".into(), PropType::Eid("board".into())),
            ("statuses".into(), PropType::Text),
        ]),
        ("shelf".into(), vec![
            ("client".into(), PropType::Eid("client".into())),
        ]),
        ("cursor".into(), vec![
            ("client".into(), PropType::Eid("client".into())),
            ("target".into(), PropType::Eid("entity".into())),
            ("view".into(), PropType::Text),
        ]),
        ("favorite".into(), vec![]),
        ("setting".into(), vec![
            ("key".into(), PropType::Text),
            ("value".into(), PropType::Text),
        ]),
        ("session".into(), vec![
            ("id".into(), PropType::Text),
            ("cwd".into(), PropType::Text),
            ("pid".into(), PropType::Number),
            ("pane".into(), PropType::Text),
            ("turn".into(), PropType::Enum(vec!["idle".into(), "busy".into()])),
            ("transcript".into(), PropType::Text),
            ("agent_type".into(), PropType::Text),
            ("source".into(), PropType::Text),
            ("operator".into(), PropType::Bool),
            ("provider".into(), PropType::Text),
            ("model".into(), PropType::Text),
            ("effort".into(), PropType::Text),
            ("requested_task".into(), PropType::Eid("entity".into())),
            ("role".into(), PropType::Eid("role".into())),
            ("persona".into(), PropType::Eid("entity".into())),
            ("actor".into(), PropType::Eid("entity".into())),
            ("parent".into(), PropType::Eid("session".into())),
        ]),
        ("brief".into(), vec![
            ("text".into(), PropType::Body),
        ]),
        ("worktree".into(), vec![
            ("cwd".into(), PropType::Text),
        ]),
        ("runtime".into(), vec![
            ("pid".into(), PropType::Number),
            ("pane".into(), PropType::Text),
            ("transcript".into(), PropType::Text),
        ]),
        ("run".into(), vec![]),
        ("settled".into(), vec![]),
        ("yield".into(), vec![]),
        ("entry".into(), vec![
            ("session".into(), PropType::Eid("session".into())),
        ]),
        ("content".into(), vec![
            ("body".into(), PropType::Body),
        ]),
        ("message".into(), vec![
            ("role".into(), PropType::Enum(vec!["user".into(), "agent".into()])),
        ]),
        ("prompt".into(), vec![]),
        ("attention".into(), vec![]),
        ("generation".into(), vec![
            ("through".into(), PropType::Eid("entry".into())),
            ("provider".into(), PropType::Text),
            ("model".into(), PropType::Text),
            ("effort".into(), PropType::Text),
        ]),
        ("output".into(), vec![
            ("source".into(), PropType::Eid("generation".into())),
            ("key".into(), PropType::Text),
            ("phase".into(), PropType::Text),
        ]),
        ("call".into(), vec![
            ("key".into(), PropType::Text),
        ]),
        ("bash".into(), vec![
            ("command".into(), PropType::Body),
            ("cwd".into(), PropType::Text),
        ]),
        ("fetch".into(), vec![
            ("url".into(), PropType::Url),
            ("method".into(), PropType::Enum(vec!["GET".into(), "HEAD".into(), "POST".into(), "PUT".into(), "PATCH".into(), "DELETE".into()])),
        ]),
        ("patch".into(), vec![
            ("path".into(), PropType::Text),
            ("diff".into(), PropType::Body),
        ]),
        ("tool".into(), vec![
            ("name".into(), PropType::Text),
            ("detail".into(), PropType::Text),
        ]),
        ("task_context".into(), vec![]),
        ("graph_query".into(), vec![
            ("query".into(), PropType::Query),
        ]),
        ("apply".into(), vec![
            ("changes".into(), PropType::Body),
        ]),
        ("result".into(), vec![
            ("call".into(), PropType::Eid("call".into())),
        ]),
        ("exit".into(), vec![
            ("code".into(), PropType::Number),
        ]),
        ("response".into(), vec![
            ("status".into(), PropType::Number),
        ]),
        ("headers".into(), vec![
            ("data".into(), PropType::Body),
        ]),
        ("stderr".into(), vec![
            ("text".into(), PropType::Body),
        ]),
        ("timeout".into(), vec![
            ("ms".into(), PropType::Number),
        ]),
        ("checkpoint".into(), vec![
            ("through".into(), PropType::Eid("entry".into())),
        ]),
        ("cancel".into(), vec![
            ("target".into(), PropType::Eid("entity".into())),
        ]),
        ("reasoning".into(), vec![]),
        ("recalled".into(), vec![
            ("source".into(), PropType::Eid("entry".into())),
            ("at".into(), PropType::Time),
        ]),
        ("opaque".into(), vec![
            ("format".into(), PropType::Text),
            ("data".into(), PropType::Body),
        ]),
        ("runner".into(), vec![
            ("name".into(), PropType::Text),
        ]),
        ("lease".into(), vec![]),
        ("usage".into(), vec![]),
        ("imported".into(), vec![]),
        ("spawn".into(), vec![
            ("provider".into(), PropType::Text),
            ("model".into(), PropType::Text),
            ("effort".into(), PropType::Text),
            ("persona".into(), PropType::Eid("entity".into())),
        ]),
        ("claim".into(), vec![
            ("session".into(), PropType::Eid("session".into())),
        ]),
        ("resume".into(), vec![]),
        ("subscription".into(), vec![
            ("actor".into(), PropType::Eid("entity".into())),
            ("target".into(), PropType::Eid("entity".into())),
            ("mode".into(), PropType::Enum(vec!["watch".into(), "mute".into()])),
        ]),
        ("chat".into(), vec![
            ("actor".into(), PropType::Eid("entity".into())),
            ("target".into(), PropType::Eid("entity".into())),
        ]),
        ("stop_request".into(), vec![
            ("target".into(), PropType::Eid("session".into())),
        ]),
        ("fork".into(), vec![
            ("from".into(), PropType::Eid("entry".into())),
        ]),
        ("knock".into(), vec![
            ("target".into(), PropType::Eid("entity".into())),
        ]),
        ("wake".into(), vec![
            ("at".into(), PropType::Time),
            ("target".into(), PropType::Eid("entity".into())),
            ("note".into(), PropType::Text),
        ]),
        ("dream".into(), vec![
            ("scope".into(), PropType::Eid("project".into())),
            ("floor".into(), PropType::Time),
        ]),
        ("mail".into(), vec![
            ("target".into(), PropType::Eid("entity".into())),
            ("reply_to".into(), PropType::Eid("mail".into())),
        ]),
        ("conflict".into(), vec![]),
        ("redaction".into(), vec![]),
        ("hook".into(), vec![]),
        ("comment".into(), vec![
            ("target".into(), PropType::Eid("entity".into())),
        ]),
        ("commit".into(), vec![
            ("target".into(), PropType::Eid("entity".into())),
            ("sha".into(), PropType::Text),
            ("repo".into(), PropType::Text),
            ("message".into(), PropType::Text),
        ]),
        ("notice".into(), vec![
            ("target".into(), PropType::Eid("entity".into())),
            ("event".into(), PropType::Enum(vec!["lapse".into(), "sweep".into(), "scene".into(), "wake".into()])),
        ]),
        ("meta".into(), vec![]),
        ("review".into(), vec![
            ("verdict".into(), PropType::Enum(vec!["approved".into(), "rejected".into(), "changes_requested".into()])),
        ]),
        ("alias".into(), vec![
            ("slug".into(), PropType::Text),
            ("slugs".into(), PropType::Text),
        ]),
        ("person".into(), vec![]),
        ("persona".into(), vec![
            ("home".into(), PropType::Eid("project".into())),
        ]),
        ("model".into(), vec![
            ("name".into(), PropType::Text),
            ("vendor".into(), PropType::Text),
            ("grade".into(), PropType::Enum(vec!["frontier".into(), "mid".into(), "small".into()])),
        ]),
        ("email".into(), vec![
            ("address".into(), PropType::Text),
        ]),
        ("memory".into(), vec![
            ("scope".into(), PropType::Eid("project".into())),
        ]),
        ("feedback".into(), vec![
            ("by".into(), PropType::Eid("entity".into())),
        ]),
        ("recall".into(), vec![]),
        ("created".into(), vec![
            ("by".into(), PropType::Eid("entity".into())),
        ]),
        ("updated".into(), vec![
            ("by".into(), PropType::Eid("entity".into())),
        ]),
        ("notified".into(), vec![]),
        ("opened".into(), vec![]),
        ("archived".into(), vec![]),
        ("quarantined".into(), vec![]),
        ("deliver".into(), vec![
            ("to".into(), PropType::Eid("entity".into())),
        ]),
        ("delivered".into(), vec![]),
        ("error".into(), vec![]),
        ("exception".into(), vec![]),
        ("bug".into(), vec![
            ("fault".into(), PropType::Text),
            ("hits".into(), PropType::Number),
            ("last".into(), PropType::Time),
        ]),
        ("finding".into(), vec![
            ("key".into(), PropType::Text),
            ("hits".into(), PropType::Number),
            ("last".into(), PropType::Time),
        ]),
        ("fixer".into(), vec![]),
        ("verifier".into(), vec![]),
        ("nofix".into(), vec![]),
        ("noverify".into(), vec![]),
        ("blocked".into(), vec![
            ("on".into(), PropType::Text),
        ]),
        ("completed".into(), vec![
            ("at".into(), PropType::Time),
            ("by".into(), PropType::Eid("entity".into())),
        ]),
        ("cancelled".into(), vec![
            ("at".into(), PropType::Time),
            ("by".into(), PropType::Eid("entity".into())),
            ("reason".into(), PropType::Text),
        ]),
        ("anchor".into(), vec![
            ("paths".into(), PropType::Text),
            ("sha".into(), PropType::Text),
            ("symbol".into(), PropType::Text),
            ("hunk".into(), PropType::Body),
            ("start".into(), PropType::Number),
            ("end".into(), PropType::Number),
        ]),
        ("decided".into(), vec![
            ("at".into(), PropType::Time),
            ("by".into(), PropType::Eid("entity".into())),
            ("verdict".into(), PropType::Enum(vec!["approved".into(), "declined".into()])),
        ]),
        ("proposed".into(), vec![
            ("at".into(), PropType::Time),
            ("by".into(), PropType::Eid("entity".into())),
        ]),
        ("effect".into(), vec![]),
        ("space".into(), vec![
            ("slug".into(), PropType::Text),
            ("home".into(), PropType::Eid("app".into())),
        ]),
        ("app".into(), vec![
            ("slug".into(), PropType::Text),
            ("space".into(), PropType::Eid("space".into())),
            ("version".into(), PropType::Number),
            ("access".into(), PropType::Enum(vec!["public".into(), "open".into(), "private".into()])),
        ]),
        ("published".into(), vec![
            ("name".into(), PropType::Text),
            ("version".into(), PropType::Number),
            ("at".into(), PropType::Time),
            ("about".into(), PropType::Text),
        ]),
        ("installed".into(), vec![
            ("of".into(), PropType::Eid("app".into())),
            ("version".into(), PropType::Number),
        ]),
        ("deploy".into(), vec![
            ("app".into(), PropType::Eid("app".into())),
            ("version".into(), PropType::Number),
            ("files".into(), PropType::Text),
            ("worker".into(), PropType::Text),
        ]),
        ("plan".into(), vec![
            ("tier".into(), PropType::Enum(vec!["free".into(), "plus".into()])),
        ]),
        ("meter".into(), vec![
            ("month".into(), PropType::Text),
            ("requests".into(), PropType::Number),
            ("rows_read".into(), PropType::Number),
            ("rows_written".into(), PropType::Number),
            ("bytes".into(), PropType::Number),
            ("emails".into(), PropType::Number),
            ("at".into(), PropType::Time),
        ]),
        ("member".into(), vec![
            ("space".into(), PropType::Eid("space".into())),
            ("person".into(), PropType::Eid("person".into())),
            ("role".into(), PropType::Enum(vec!["owner".into(), "editor".into(), "viewer".into()])),
        ]),
        ("signin".into(), vec![]),
        ("edge".into(), vec![
            ("from".into(), PropType::Eid("entity".into())),
            ("to".into(), PropType::Eid("entity".into())),
            ("ord".into(), PropType::Number),
        ]),
        ("requires".into(), vec![]),
        ("contains".into(), vec![]),
        ("reads".into(), vec![]),
        ("about".into(), vec![]),
        ("supervises".into(), vec![]),
        ("delegates".into(), vec![]),
        ("supersedes".into(), vec![]),
        ("worked".into(), vec![]),
        ("references".into(), vec![]),
        ("wants".into(), vec![]),
        ("satisfies".into(), vec![]),
    ];
    let stamped = HashMap::from([
        ("entity".into(), vec![
            ("num".into(), PropType::Number),
        ]),
        ("created".into(), vec![
            ("at".into(), PropType::Time),
            ("via".into(), PropType::Eid("entity".into())),
        ]),
        ("updated".into(), vec![
            ("at".into(), PropType::Time),
            ("via".into(), PropType::Eid("entity".into())),
        ]),
        ("notified".into(), vec![
            ("at".into(), PropType::Time),
            ("by".into(), PropType::Eid("entity".into())),
            ("via".into(), PropType::Eid("entity".into())),
        ]),
        ("opened".into(), vec![
            ("at".into(), PropType::Time),
            ("by".into(), PropType::Eid("entity".into())),
            ("via".into(), PropType::Eid("entity".into())),
        ]),
        ("archived".into(), vec![
            ("at".into(), PropType::Time),
            ("by".into(), PropType::Eid("entity".into())),
            ("via".into(), PropType::Eid("entity".into())),
        ]),
        ("quarantined".into(), vec![
            ("at".into(), PropType::Time),
            ("by".into(), PropType::Eid("entity".into())),
            ("via".into(), PropType::Eid("entity".into())),
        ]),
        ("favorite".into(), vec![
            ("at".into(), PropType::Time),
        ]),
        ("decided".into(), vec![
            ("via".into(), PropType::Eid("entity".into())),
        ]),
        ("proposed".into(), vec![
            ("via".into(), PropType::Eid("entity".into())),
        ]),
        ("web".into(), vec![
            ("frozen_at".into(), PropType::Time),
        ]),
        ("client".into(), vec![
            ("ip".into(), PropType::Text),
        ]),
        ("claim".into(), vec![
            ("claimed_at".into(), PropType::Time),
        ]),
        ("resume".into(), vec![
            ("actor".into(), PropType::Eid("entity".into())),
            ("at".into(), PropType::Time),
            ("rank".into(), PropType::Number),
        ]),
        ("delivered".into(), vec![
            ("at".into(), PropType::Time),
            ("via".into(), PropType::Text),
        ]),
        ("error".into(), vec![
            ("at".into(), PropType::Time),
            ("message".into(), PropType::Text),
        ]),
        ("exception".into(), vec![
            ("at".into(), PropType::Time),
            ("message".into(), PropType::Text),
            ("stack".into(), PropType::Text),
            ("request".into(), PropType::Text),
            ("version".into(), PropType::Number),
        ]),
        ("blocked".into(), vec![
            ("since".into(), PropType::Time),
        ]),
        ("mail".into(), vec![
            ("from".into(), PropType::Text),
            ("to_addr".into(), PropType::Text),
            ("message_id".into(), PropType::Text),
            ("received_at".into(), PropType::Time),
            ("verified".into(), PropType::Bool),
            ("sent_id".into(), PropType::Text),
            ("in_reply_to".into(), PropType::Text),
            ("headers".into(), PropType::Text),
        ]),
        ("hook".into(), vec![
            ("source".into(), PropType::Text),
            ("event".into(), PropType::Text),
            ("payload".into(), PropType::Body),
            ("spool_id".into(), PropType::Text),
            ("received_at".into(), PropType::Time),
            ("method".into(), PropType::Text),
            ("path".into(), PropType::Text),
            ("headers".into(), PropType::Body),
            ("sig_ok".into(), PropType::Bool),
        ]),
        ("memory".into(), vec![
            ("last_confirmed_at".into(), PropType::Time),
        ]),
        ("recall".into(), vec![
            ("count".into(), PropType::Number),
            ("first_at".into(), PropType::Time),
            ("last_at".into(), PropType::Time),
        ]),
        ("conflict".into(), vec![
            ("target".into(), PropType::Eid("entity".into())),
            ("loser".into(), PropType::Eid("session".into())),
            ("holder".into(), PropType::Eid("session".into())),
            ("at".into(), PropType::Time),
        ]),
        ("redaction".into(), vec![
            ("target".into(), PropType::Eid("entity".into())),
            ("column".into(), PropType::Enum(vec!["title".into(), "body".into()])),
            ("hash".into(), PropType::Text),
        ]),
        ("role".into(), vec![
            ("applied_hash".into(), PropType::Text),
            ("applied_at".into(), PropType::Time),
            ("stopped_at".into(), PropType::Time),
            ("decision".into(), PropType::Text),
            ("reason".into(), PropType::Text),
            ("observed".into(), PropType::Eid("entity".into())),
            ("decided_at".into(), PropType::Time),
        ]),
        ("session".into(), vec![
            ("notice_at".into(), PropType::Time),
            ("notice_accepted_at".into(), PropType::Time),
            ("notice_token".into(), PropType::Text),
            ("origin".into(), PropType::Enum(vec!["external".into(), "managed".into()])),
            ("branch".into(), PropType::Text),
            ("base_revision".into(), PropType::Text),
            ("status".into(), PropType::Text),
            ("provider_session_id".into(), PropType::Text),
            ("serving_model".into(), PropType::Text),
            ("latest_seq".into(), PropType::Number),
            ("standing".into(), PropType::Text),
            ("started_at".into(), PropType::Time),
            ("stop_requested_at".into(), PropType::Time),
            ("input_at".into(), PropType::Time),
            ("finished_at".into(), PropType::Time),
            ("exit_code".into(), PropType::Number),
            ("stop_reason".into(), PropType::Text),
            ("final_text".into(), PropType::Body),
            ("usage_json".into(), PropType::Text),
            ("stderr".into(), PropType::Body),
        ]),
        ("worktree".into(), vec![
            ("branch".into(), PropType::Text),
            ("base_revision".into(), PropType::Text),
        ]),
        ("runtime".into(), vec![
            ("provider_session_id".into(), PropType::Text),
            ("serving_model".into(), PropType::Text),
        ]),
        ("run".into(), vec![
            ("status".into(), PropType::Enum(vec!["starting".into(), "running".into(), "stopping".into()])),
            ("started_at".into(), PropType::Time),
            ("stop_requested_at".into(), PropType::Time),
            ("input_at".into(), PropType::Time),
        ]),
        ("settled".into(), vec![
            ("at".into(), PropType::Time),
            ("status".into(), PropType::Enum(vec!["completed".into(), "failed".into(), "interrupted".into(), "lost".into()])),
            ("exit_code".into(), PropType::Number),
            ("stop_reason".into(), PropType::Text),
        ]),
        ("yield".into(), vec![
            ("final_text".into(), PropType::Body),
            ("usage_json".into(), PropType::Text),
            ("stderr".into(), PropType::Body),
        ]),
        ("entry".into(), vec![
            ("seq".into(), PropType::Number),
        ]),
        ("generation".into(), vec![
            ("serving_model".into(), PropType::Text),
        ]),
        ("imported".into(), vec![
            ("source".into(), PropType::Text),
            ("line".into(), PropType::Number),
        ]),
        ("lease".into(), vec![
            ("holder".into(), PropType::Eid("runner".into())),
            ("at".into(), PropType::Time),
            ("until".into(), PropType::Time),
        ]),
        ("usage".into(), vec![
            ("input".into(), PropType::Number),
            ("cached".into(), PropType::Number),
            ("output".into(), PropType::Number),
            ("reasoning".into(), PropType::Number),
        ]),
        ("effect".into(), vec![
            ("jrow".into(), PropType::Number),
            ("handler".into(), PropType::Text),
            ("state".into(), PropType::Enum(vec!["pending".into(), "leased".into(), "delivered".into(), "failed".into()])),
            ("attempts".into(), PropType::Number),
            ("lease_owner".into(), PropType::Text),
            ("lease_token".into(), PropType::Text),
            ("lease_expiry".into(), PropType::Time),
        ]),
        ("completed".into(), vec![
            ("via".into(), PropType::Eid("entity".into())),
        ]),
        ("cancelled".into(), vec![
            ("via".into(), PropType::Eid("entity".into())),
        ]),
        ("signin".into(), vec![
            ("email".into(), PropType::Text),
            ("code".into(), PropType::Text),
            ("expires".into(), PropType::Time),
            ("tries".into(), PropType::Number),
        ]),
    ]);
    let prefix = HashMap::from([
        ("task".into(), "T".into()),
        ("project".into(), "P".into()),
        ("role".into(), "R".into()),
        ("board".into(), "B".into()),
        ("layout".into(), "L".into()),
        ("goal".into(), "V".into()),
        ("session".into(), "S".into()),
        ("knock".into(), "K".into()),
        ("wake".into(), "W".into()),
        ("dream".into(), "Z".into()),
        ("mail".into(), "E".into()),
        ("redaction".into(), "X".into()),
        ("hook".into(), "H".into()),
        ("commit".into(), "G".into()),
        ("person".into(), "U".into()),
        ("persona".into(), "N".into()),
        ("model".into(), "O".into()),
        ("email".into(), "A".into()),
        ("memory".into(), "M".into()),
    ]);
    let kind_order = vec!["design".into(), "goal".into(), "task".into(), "project".into(), "layout".into(), "board".into(), "canvas".into(), "web".into(), "card".into(), "pane".into(), "client".into(), "camera".into(), "fold".into(), "cursor".into(), "role".into(), "session".into(), "entry".into(), "runner".into(), "claim".into(), "subscription".into(), "stop_request".into(), "knock".into(), "wake".into(), "dream".into(), "mail".into(), "hook".into(), "conflict".into(), "redaction".into(), "review".into(), "notice".into(), "commit".into(), "comment".into(), "memory".into(), "person".into(), "persona".into(), "model".into(), "edge".into(), "attachment".into(), "doc".into(), "email".into(), "alias".into(), "space".into(), "plan".into(), "app".into(), "deploy".into(), "member".into(), "signin".into()];
    let statuses = vec!["open".into(), "wip".into(), "done".into(), "cancelled".into()];
    let renames = vec![
        ("view:Debug.ListItem".into(), "Debug.Tile".into()),
        ("view:Id".into(), "Inline".into()),
        ("view:List.Item".into(), "List.Tile".into()),
        ("view:Show".into(), "Full".into()),
        ("view:Task.Row".into(), "Board.List.Tile".into()),
    ];
    let deaths = vec![
        ("task".into(), "project".into(), "detach".into()),
        ("task".into(), "assignee".into(), "detach".into()),
        ("role".into(), "scope".into(), "detach".into()),
        ("role".into(), "checkout".into(), "detach".into()),
        ("role".into(), "wake_target".into(), "detach".into()),
        ("layout".into(), "root".into(), "detach".into()),
        ("pane".into(), "layout".into(), "cascade".into()),
        ("pane".into(), "parent".into(), "cascade".into()),
        ("pane".into(), "content".into(), "detach".into()),
        ("goal".into(), "scope".into(), "keep".into()),
        ("attachment".into(), "blob".into(), "cascade".into()),
        ("card".into(), "target".into(), "cascade".into()),
        ("pin".into(), "canvas".into(), "cascade".into()),
        ("client".into(), "actor".into(), "detach".into()),
        ("camera".into(), "client".into(), "cascade".into()),
        ("camera".into(), "canvas".into(), "cascade".into()),
        ("fold".into(), "client".into(), "cascade".into()),
        ("fold".into(), "board".into(), "cascade".into()),
        ("shelf".into(), "client".into(), "release".into()),
        ("cursor".into(), "client".into(), "cascade".into()),
        ("cursor".into(), "target".into(), "keep".into()),
        ("session".into(), "requested_task".into(), "detach".into()),
        ("session".into(), "role".into(), "keep".into()),
        ("session".into(), "persona".into(), "detach".into()),
        ("session".into(), "actor".into(), "detach".into()),
        ("session".into(), "parent".into(), "detach".into()),
        ("entry".into(), "session".into(), "cascade".into()),
        ("generation".into(), "through".into(), "keep".into()),
        ("output".into(), "source".into(), "keep".into()),
        ("result".into(), "call".into(), "keep".into()),
        ("checkpoint".into(), "through".into(), "keep".into()),
        ("cancel".into(), "target".into(), "keep".into()),
        ("recalled".into(), "source".into(), "keep".into()),
        ("spawn".into(), "persona".into(), "detach".into()),
        ("claim".into(), "session".into(), "release".into()),
        ("subscription".into(), "actor".into(), "cascade".into()),
        ("subscription".into(), "target".into(), "cascade".into()),
        ("chat".into(), "actor".into(), "detach".into()),
        ("chat".into(), "target".into(), "detach".into()),
        ("stop_request".into(), "target".into(), "cascade".into()),
        ("fork".into(), "from".into(), "detach".into()),
        ("knock".into(), "target".into(), "cascade".into()),
        ("wake".into(), "target".into(), "cascade".into()),
        ("dream".into(), "scope".into(), "cascade".into()),
        ("mail".into(), "target".into(), "keep".into()),
        ("mail".into(), "reply_to".into(), "keep".into()),
        ("comment".into(), "target".into(), "cascade".into()),
        ("commit".into(), "target".into(), "cascade".into()),
        ("notice".into(), "target".into(), "cascade".into()),
        ("persona".into(), "home".into(), "detach".into()),
        ("memory".into(), "scope".into(), "keep".into()),
        ("feedback".into(), "by".into(), "keep".into()),
        ("created".into(), "by".into(), "keep".into()),
        ("updated".into(), "by".into(), "keep".into()),
        ("deliver".into(), "to".into(), "keep".into()),
        ("completed".into(), "by".into(), "keep".into()),
        ("cancelled".into(), "by".into(), "keep".into()),
        ("decided".into(), "by".into(), "keep".into()),
        ("proposed".into(), "by".into(), "keep".into()),
        ("space".into(), "home".into(), "detach".into()),
        ("app".into(), "space".into(), "cascade".into()),
        ("installed".into(), "of".into(), "detach".into()),
        ("deploy".into(), "app".into(), "cascade".into()),
        ("member".into(), "space".into(), "cascade".into()),
        ("member".into(), "person".into(), "cascade".into()),
        ("edge".into(), "from".into(), "cascade".into()),
        ("edge".into(), "to".into(), "cascade".into()),
    ];
    let edges = vec!["requires".into(), "contains".into(), "reads".into(), "about".into(), "supervises".into(), "delegates".into(), "recalled".into(), "supersedes".into(), "worked".into(), "referenced".into(), "wants".into(), "satisfies".into()];
    let governed = vec!["task".into(), "architecture".into(), "memory".into(), "persona".into()];
    let session_comps = vec!["entry".into(), "content".into(), "message".into(), "prompt".into(), "attention".into(), "generation".into(), "output".into(), "call".into(), "bash".into(), "fetch".into(), "patch".into(), "tool".into(), "task_context".into(), "graph_query".into(), "apply".into(), "result".into(), "exit".into(), "response".into(), "headers".into(), "stderr".into(), "timeout".into(), "checkpoint".into(), "cancel".into(), "reasoning".into(), "recalled".into(), "opaque".into(), "runner".into(), "lease".into(), "usage".into(), "imported".into()];
    let session_facets = vec!["spawn".into(), "worktree".into(), "runtime".into(), "run".into(), "settled".into(), "yield".into()];
    Vocab { comps, stamped, kind_order, prefix, statuses, renames, deaths, edges, governed, session_comps, session_facets }
}
