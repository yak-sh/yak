// The #[derive(Comp)] proc-macro (D-22530 §6): one annotated Rust struct is
// one vocabulary component, and the derive is the whole authoring surface —
// it reads struct attributes (rank/prefix/enum/stamped/well and the rest) plus
// the column fields into a `yak_vocab::CompDef` and `inventory::submit!`s it,
// so assembling the contract is just iterating the inventory. The compiler
// checks the vocabulary; there is one less hand-rolled DSL.
//
//   #[derive(Comp)]
//   #[comp(plugin = "work", rank = 20, kind_rank = 20, prefix = "T")]
//   struct Task {
//       #[col(sel = "statuses")]           status: Sel,
//       priority:                          Priority,
//       #[col(eid = "project", death = "detach")] project: Ref,
//       #[col(well = "domains")]           domain: Well,
//   }
//
// A field's base PropType is its marker type (Text/Body/Number/Priority/Bool/
// Time/Url/Query); a `#[col(...)]` attribute overrides it with a reference
// (eid), a closed set (sel — named or inline, optional input aliases), or an
// open well. `#[stamped]` routes a field into the server-owned half. Struct
// `#[index(cols(...), unique, where = "…")]` attributes carry composite
// indexes. The comp NAME is the struct ident in snake_case unless `name = "…"`
// overrides it.

use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, Data, DeriveInput, Fields, LitStr};

// A struct-level scalar attribute we accept as `key = value`.
#[derive(Default)]
struct CompAttrs {
    plugin: Option<String>,
    name: Option<String>,
    rank: Option<i64>,
    kind_rank: Option<i64>,
    stamped_rank: Option<i64>,
    prefix: Option<String>,
    plural: Option<String>,
    by_name: bool,
    lazy: bool,
    log: bool,
    wire_false: bool,
}

struct IndexAttr {
    cols: Vec<String>,
    unique: bool,
    where_: Option<String>,
}

// The base PropType a marker field type names.
fn scalar_prop(ident: &str) -> Option<proc_macro2::TokenStream> {
    let v = match ident {
        "Text" => "Text",
        "Body" => "Body",
        "Number" => "Number",
        "Priority" => "Priority",
        "Bool" => "Bool",
        "Time" => "Time",
        "Url" => "Url",
        "Query" => "Query",
        _ => return None,
    };
    let id = syn::Ident::new(v, proc_macro2::Span::call_site());
    Some(quote! { ::yak_vocab::Prop::#id })
}

fn snake(name: &str) -> String {
    let mut out = String::new();
    for (i, c) in name.chars().enumerate() {
        if c.is_uppercase() {
            if i != 0 {
                out.push('_');
            }
            out.extend(c.to_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

#[proc_macro_derive(Comp, attributes(comp, col, stamped, index))]
pub fn derive_comp(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let struct_ident = input.ident.clone();

    let mut attrs = CompAttrs::default();
    let mut indexes: Vec<IndexAttr> = Vec::new();

    for a in &input.attrs {
        if a.path().is_ident("comp") {
            a.parse_nested_meta(|m| {
                if m.path.is_ident("plugin") {
                    attrs.plugin = Some(m.value()?.parse::<LitStr>()?.value());
                } else if m.path.is_ident("name") {
                    attrs.name = Some(m.value()?.parse::<LitStr>()?.value());
                } else if m.path.is_ident("prefix") {
                    attrs.prefix = Some(m.value()?.parse::<LitStr>()?.value());
                } else if m.path.is_ident("plural") {
                    attrs.plural = Some(m.value()?.parse::<LitStr>()?.value());
                } else if m.path.is_ident("rank") {
                    attrs.rank = Some(m.value()?.parse::<syn::LitInt>()?.base10_parse()?);
                } else if m.path.is_ident("kind_rank") {
                    attrs.kind_rank = Some(m.value()?.parse::<syn::LitInt>()?.base10_parse()?);
                } else if m.path.is_ident("stamped_rank") {
                    attrs.stamped_rank = Some(m.value()?.parse::<syn::LitInt>()?.base10_parse()?);
                } else if m.path.is_ident("by_name") {
                    attrs.by_name = true;
                } else if m.path.is_ident("lazy") {
                    attrs.lazy = true;
                } else if m.path.is_ident("log") {
                    attrs.log = true;
                } else if m.path.is_ident("wire") {
                    // only `wire = false` is meaningful (the stamped-only spine)
                    let v: syn::LitBool = m.value()?.parse()?;
                    attrs.wire_false = !v.value();
                } else {
                    return Err(m.error("unknown comp attribute"));
                }
                Ok(())
            })
            .unwrap();
        } else if a.path().is_ident("index") {
            let mut cols: Vec<String> = Vec::new();
            let mut unique = false;
            let mut where_: Option<String> = None;
            a.parse_nested_meta(|m| {
                if m.path.is_ident("cols") {
                    m.parse_nested_meta(|c| {
                        cols.push(c.path.get_ident().unwrap().to_string());
                        Ok(())
                    })?;
                } else if m.path.is_ident("unique") {
                    unique = true;
                } else if m.path.is_ident("filter") {
                    where_ = Some(m.value()?.parse::<LitStr>()?.value());
                } else {
                    return Err(m.error("unknown index attribute"));
                }
                Ok(())
            })
            .unwrap();
            indexes.push(IndexAttr { cols, unique, where_ });
        }
    }

    let plugin = attrs.plugin.expect("#[comp(plugin = \"…\")] is required");
    let comp_name = attrs.name.unwrap_or_else(|| snake(&struct_ident.to_string()));

    // Walk the fields into cols / stamped ColDef literals.
    let mut cols = Vec::new();
    let mut stamped = Vec::new();
    if let Data::Struct(s) = &input.data {
        if let Fields::Named(named) = &s.fields {
            for f in &named.named {
                let fname = f.ident.as_ref().unwrap().to_string();
                let fname = fname.strip_prefix("r#").unwrap_or(&fname).to_string();
                let mut is_stamped = false;
                let mut prop: Option<proc_macro2::TokenStream> = None;

                for a in &f.attrs {
                    if a.path().is_ident("stamped") {
                        is_stamped = true;
                    } else if a.path().is_ident("col") {
                        prop = Some(parse_col(a));
                    }
                }

                let prop = prop.unwrap_or_else(|| {
                    // base type from the marker field type
                    let ty = &f.ty;
                    let id = match ty {
                        syn::Type::Path(p) => p.path.segments.last().map(|s| s.ident.to_string()),
                        _ => None,
                    };
                    id.as_deref().and_then(scalar_prop).unwrap_or_else(|| {
                        panic!("field `{fname}` needs a marker type or #[col(...)]")
                    })
                });

                let lit = quote! {
                    ::yak_vocab::ColDef { name: #fname, prop: #prop }
                };
                if is_stamped {
                    stamped.push(lit);
                } else {
                    cols.push(lit);
                }
            }
        }
    }

    let index_lits = indexes.iter().map(|i| {
        let cols = &i.cols;
        let unique = i.unique;
        let where_ = match &i.where_ {
            Some(w) => quote! { Some(#w) },
            None => quote! { None },
        };
        quote! {
            ::yak_vocab::IndexDef { cols: &[#(#cols),*], unique: #unique, where_: #where_ }
        }
    });

    let opt_i64 = |v: Option<i64>| match v {
        Some(n) => quote! { Some(#n) },
        None => quote! { None },
    };
    let opt_str = |v: &Option<String>| match v {
        Some(s) => quote! { Some(#s) },
        None => quote! { None },
    };
    let rank = opt_i64(attrs.rank);
    let kind_rank = opt_i64(attrs.kind_rank);
    let stamped_rank = opt_i64(attrs.stamped_rank);
    let prefix = opt_str(&attrs.prefix);
    let plural = opt_str(&attrs.plural);
    let wire = if attrs.wire_false {
        quote! { Some(false) }
    } else {
        quote! { None }
    };
    let by_name = attrs.by_name;
    let lazy = attrs.lazy;
    let log = attrs.log;

    let expanded = quote! {
        ::inventory::submit! {
            ::yak_vocab::CompDef {
                plugin: #plugin,
                name: #comp_name,
                rank: #rank,
                wire: #wire,
                stamped_rank: #stamped_rank,
                kind_rank: #kind_rank,
                prefix: #prefix,
                by_name: #by_name,
                lazy: #lazy,
                log: #log,
                plural: #plural,
                cols: &[#(#cols),*],
                stamped: &[#(#stamped),*],
                indexes: &[#(#index_lits),*],
            }
        }
        // Silence dead_code on the marker struct — the derive IS its use.
        #[allow(dead_code)]
        const _: fn() = || {
            let _ = ::core::any::type_name::<#struct_ident>();
        };
    };
    expanded.into()
}

// Parse one #[col(...)] attribute into a Prop literal.
fn parse_col(a: &syn::Attribute) -> proc_macro2::TokenStream {
    let mut eid: Option<String> = None;
    let mut death: Option<String> = None;
    let mut sel_name: Option<String> = None;
    let mut sel_inline: Vec<String> = Vec::new();
    let mut aliases: Vec<(String, String)> = Vec::new();
    let mut well: Option<String> = None;

    a.parse_nested_meta(|m| {
        if m.path.is_ident("eid") {
            eid = Some(m.value()?.parse::<LitStr>()?.value());
        } else if m.path.is_ident("death") {
            death = Some(m.value()?.parse::<LitStr>()?.value());
        } else if m.path.is_ident("well") {
            well = Some(m.value()?.parse::<LitStr>()?.value());
        } else if m.path.is_ident("sel") {
            // either `sel = "name"` (named enum) or `sel("a", "b")` (inline)
            if let Ok(v) = m.value() {
                sel_name = Some(v.parse::<LitStr>()?.value());
            } else {
                m.parse_nested_meta(|v| {
                    // each inline value is a string-literal path segment; take it
                    // from the token by re-parsing the meta path as a lit str.
                    let s = v.path.get_ident().map(|i| i.to_string());
                    if let Some(s) = s {
                        sel_inline.push(s);
                        Ok(())
                    } else {
                        Err(v.error("inline sel values must be bare identifiers"))
                    }
                })?;
            }
        } else if m.path.is_ident("alias") {
            m.parse_nested_meta(|al| {
                let k = al.path.get_ident().unwrap().to_string();
                let v = al.value()?.parse::<LitStr>()?.value();
                aliases.push((k, v));
                Ok(())
            })?;
        } else {
            return Err(m.error("unknown col attribute"));
        }
        Ok(())
    })
    .unwrap();

    if let Some(t) = eid {
        let d = death.expect("#[col(eid = …)] needs death = \"…\"");
        return quote! { ::yak_vocab::Prop::Eid { target: #t, death: #d } };
    }
    if let Some(w) = well {
        return quote! { ::yak_vocab::Prop::Well(#w) };
    }
    if let Some(n) = sel_name {
        let ks = aliases.iter().map(|(k, _)| k.clone());
        let vs = aliases.iter().map(|(_, v)| v.clone());
        return quote! {
            ::yak_vocab::Prop::EnumNamed { name: #n, aliases: &[#((#ks, #vs)),*] }
        };
    }
    if !sel_inline.is_empty() {
        return quote! { ::yak_vocab::Prop::EnumInline(&[#(#sel_inline),*]) };
    }
    panic!("#[col(...)] needs one of eid / sel / well");
}
