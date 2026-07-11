// Pure, side-effect-free document-processing pipeline: chunking, section
// scanning, and the tolerant LLM-JSON parse. No network, no DB — so every
// function here is unit-testable without a running llama-server.
// ponytail: page numbers come from counting form-feeds (\x0c) as pdf-extract
// emits them; if the extractor changes, this heuristic changes with it.
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub text: String,
    pub page: u32, // 1-based; pages are delimited by form-feed (\x0c) from pdf-extract
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub label: String, // canonical display, e.g. "Section 4(b)"
    pub page: u32,     // page of the heading (first occurrence)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reference {
    pub source_label: String, // enclosing section the reference appears in ("" if before any heading)
    pub target_label: String, // section being referenced
    pub page: u32,            // page the reference appears on
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Definition {
    pub term: String,
    pub explanation: String,
}

/// Split text into overlapping char windows (1024 chars, 128 overlap), tagging
/// each with the page it starts on (form-feeds seen before its start + 1).
pub fn chunk_text(raw: &str) -> Vec<Chunk> {
    let chars: Vec<char> = raw.chars().collect();
    let (size, overlap) = (1024, 128);
    let mut out = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let end = (start + size).min(chars.len());
        let text: String = chars[start..end].iter().collect();
        if !text.trim().is_empty() {
            let page = chars[..start].iter().filter(|&&c| c == '\x0c').count() as u32 + 1;
            out.push(Chunk { text, page });
        }
        if end == chars.len() {
            break;
        }
        start += size - overlap;
    }
    out
}

/// Find internal section references with a pure regex scan (no LLM): the first
/// occurrence of a label ("Section 4(b)", "Article III") is treated as its
/// heading and fixes its page; later occurrences are references from whatever
/// heading is currently in scope. ponytail: first-occurrence-is-heading is a
/// heuristic — a forward reference before its heading mis-tags as the heading.
/// Good enough for navigation; upgrade with real heading detection if needed.
pub fn extract_sections(text: &str) -> (Vec<Section>, Vec<Reference>) {
    static RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)\b(section|article)\s+(\d+)\s*(\([a-z0-9]+\))?").unwrap()
    });

    let mut sections: Vec<Section> = Vec::new();
    let mut references: Vec<Reference> = Vec::new();
    let mut seen: std::collections::HashMap<String, ()> = std::collections::HashMap::new();
    let mut current = String::new(); // label of the heading currently in scope

    for m in RE.find_iter(text) {
        let kind = if text[m.start()..].to_lowercase().starts_with("article") {
            "Article"
        } else {
            "Section"
        };
        let caps = RE.captures(&text[m.start()..m.end()]).unwrap();
        let num = caps.get(2).map(|g| g.as_str()).unwrap_or("");
        let suffix = caps.get(3).map(|g| g.as_str().to_lowercase()).unwrap_or_default();
        let label = format!("{kind} {num}{suffix}");
        let key = label.to_lowercase();
        let page = text[..m.start()].matches('\x0c').count() as u32 + 1;

        if seen.insert(key.clone(), ()).is_none() {
            // First sighting: this is the heading.
            sections.push(Section { label: label.clone(), page });
            current = label;
        } else {
            // A reference to an already-defined section.
            references.push(Reference {
                source_label: current.clone(),
                target_label: label,
                page,
            });
        }
    }
    (sections, references)
}

/// Tolerant parse of an LLM JSON-array reply: strips ``` fences and slices to
/// the outermost [ ... ]. Returns empty on anything unparseable.
pub(crate) fn parse_json_array<T: serde::de::DeserializeOwned>(raw: &str) -> Vec<T> {
    let trimmed = raw.trim().trim_start_matches("```json").trim_matches('`');
    let slice = match (trimmed.find('['), trimmed.rfind(']')) {
        (Some(a), Some(b)) if b > a => &trimmed[a..=b],
        _ => return Vec::new(),
    };
    serde_json::from_str(slice).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{chunk_text, extract_sections};
    #[test]
    fn chunks_overlap_cover_and_track_pages() {
        let text = format!("{}\x0c{}", "a".repeat(1500), "b".repeat(1000));
        let chunks = chunk_text(&text);
        assert_eq!(chunks[0].page, 1);
        assert_eq!(chunks[0].text.chars().count(), 1024);
        // a later chunk starts after the form-feed -> page 2
        assert!(chunks.iter().any(|c| c.page == 2));
    }

    #[test]
    fn sections_headings_and_backreferences() {
        // Section 1 heading on p.1; Section 2 heading on p.2 references Section 1.
        let text = "Section 1 Definitions. The term applies here.\x0c\
                    Section 2 Term. As described in Section 1(a) above, this controls.";
        let (sections, refs) = extract_sections(text);
        let labels: Vec<_> = sections.iter().map(|s| s.label.as_str()).collect();
        assert!(labels.contains(&"Section 1"));
        assert!(labels.contains(&"Section 2"));
        let s1 = sections.iter().find(|s| s.label == "Section 1").unwrap();
        assert_eq!(s1.page, 1);
        let s2 = sections.iter().find(|s| s.label == "Section 2").unwrap();
        assert_eq!(s2.page, 2);
        let text2 = "Section 1 A.\x0cSection 2 B. See Section 1 for details.";
        let (_s, refs2) = extract_sections(text2);
        let r = refs2.iter().find(|r| r.target_label == "Section 1").unwrap();
        assert_eq!(r.source_label, "Section 2");
        assert_eq!(r.page, 2);
        let _ = refs;
    }
}
