// front.rs — the strangler FRONT. The bridge is the single endpoint clients
// hit: it serves the data plane and the ported app-plane routes NATIVELY, and
// forwards every path it does NOT natively route to the demoted Deno server
// (`TASKS_PLANE=app`, D-22920 / T-22935). This module owns the two pure
// decisions that shape a forward — where a request goes, and which headers a
// hop must strip — so `main.rs` keeps only the axum + tokio streaming glue.
//
// The forward preserves method + headers + body and relays Deno's response
// verbatim, STREAMING the body (a /blob, /frozen, or mail attachment can be
// large — never buffer one whole). It is the mirror of the write proxy
// (T-22927): a write reaching a KEPT Deno door is proxied BACK to the bridge's
// native /apply — the sole writer — so no write ever loops, because /apply and
// /ws are native routes the fallback never sees.

use axum::http::Uri;

// The demoted Deno's URL for THIS request: its app-plane base with the incoming
// path AND query appended verbatim, so `?…` filters and slugs ride through
// unchanged. A base with a trailing slash is normalized so we never emit `//`.
pub fn target_url(base: &str, uri: &Uri) -> String {
    let pq = uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    format!("{}{}", base.trim_end_matches('/'), pq)
}

// A hop-by-hop header is meaningful only to a single transport connection, so a
// proxy must NOT copy it from one hop to the next (RFC 9110 §7.6.1): the
// connection-control set, plus `host`/`content-length` which the client (ureq
// out, axum/hyper back) sets for its own hop from the URL and the body it holds.
// Everything else — content-type, x-via, cookie, authorization, accept — rides
// through, so a proxied answer is byte-identical and attribution is preserved.
pub fn is_hop_by_hop(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "host"
            | "content-length"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uri(s: &str) -> Uri {
        s.parse().unwrap()
    }

    #[test]
    fn target_joins_path_and_query() {
        let b = "http://127.0.0.1:5174";
        assert_eq!(
            target_url(b, &uri("/frozen/N-3?plain=1")),
            "http://127.0.0.1:5174/frozen/N-3?plain=1"
        );
        assert_eq!(target_url(b, &uri("/")), "http://127.0.0.1:5174/");
        assert_eq!(target_url(b, &uri("/blob/abc123")), "http://127.0.0.1:5174/blob/abc123");
    }

    #[test]
    fn target_normalizes_trailing_slash_on_base() {
        // A base with a trailing slash must not double it onto the path.
        assert_eq!(target_url("http://x/", &uri("/mcp")), "http://x/mcp");
    }

    #[test]
    fn hop_by_hop_is_case_insensitive_and_named() {
        for h in
            ["connection", "Transfer-Encoding", "UPGRADE", "host", "Content-Length", "keep-alive"]
        {
            assert!(is_hop_by_hop(h), "{h} should be hop-by-hop");
        }
    }

    #[test]
    fn end_to_end_headers_ride_through() {
        for h in ["content-type", "x-via", "cookie", "authorization", "accept", "location"] {
            assert!(!is_hop_by_hop(h), "{h} must be forwarded end-to-end");
        }
    }
}
