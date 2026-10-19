//! Deterministic text fixes applied to every dictation, with no model involved:
//! dictionary corrections and snippet expansion.

use crate::settings::{Replacement, Snippet};

/// The snippet whose trigger is the whole utterance ("My LinkedIn." → its text).
/// Speech-to-text adds capitals and punctuation, so both are ignored.
pub fn whole_snippet<'a>(text: &str, snippets: &'a [Snippet]) -> Option<&'a str> {
    let said = normalize(text);
    if said.is_empty() {
        return None;
    }
    snippets.iter().find(|s| !s.text.is_empty() && normalize(&s.trigger) == said).map(|s| s.text.as_str())
}

/// Apply dictionary corrections, then expand snippet triggers said mid-sentence.
pub fn apply(text: &str, replacements: &[Replacement], snippets: &[Snippet]) -> String {
    let pairs = replacements
        .iter()
        .map(|r| (r.from.as_str(), r.to.as_str()))
        .chain(snippets.iter().map(|s| (s.trigger.as_str(), s.text.as_str())));
    replace_phrases(text, pairs)
}

fn normalize(s: &str) -> String {
    let trimmed = s.trim().trim_matches(|c: char| c.is_ascii_punctuation() || c.is_whitespace() || c == '“' || c == '”');
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Replace whole-word, ASCII-case-insensitive occurrences of each `from` with
/// its `to`, in one pass (longest phrase first), so replaced text is never
/// replaced again.
fn replace_phrases<'a>(text: &str, pairs: impl Iterator<Item = (&'a str, &'a str)>) -> String {
    let mut pairs: Vec<(&str, &str)> = pairs.map(|(f, t)| (f.trim(), t)).filter(|(f, _)| !f.is_empty()).collect();
    if pairs.is_empty() {
        return text.to_string();
    }
    pairs.sort_by_key(|(f, _)| std::cmp::Reverse(f.len()));

    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    'outer: while i < text.len() {
        if text.is_char_boundary(i) && !word_char_before(text, i) {
            for (from, to) in &pairs {
                let end = i + from.len();
                if end <= text.len()
                    && text.is_char_boundary(end)
                    && bytes[i..end].eq_ignore_ascii_case(from.as_bytes())
                    && !word_char_after(text, end)
                {
                    out.push_str(to);
                    i = end;
                    continue 'outer;
                }
            }
        }
        let c = text[i..].chars().next().unwrap();
        out.push(c);
        i += c.len_utf8();
    }
    out
}

fn word_char_before(text: &str, i: usize) -> bool {
    text[..i].chars().next_back().is_some_and(char::is_alphanumeric)
}

fn word_char_after(text: &str, i: usize) -> bool {
    text[i..].chars().next().is_some_and(char::is_alphanumeric)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rep(from: &str, to: &str) -> Replacement {
        Replacement { from: from.into(), to: to.into() }
    }

    fn snip(trigger: &str, text: &str) -> Snippet {
        Snippet { trigger: trigger.into(), text: text.into() }
    }

    #[test]
    fn matches_a_whole_utterance_snippet() {
        let s = [snip("my linkedin", "https://linkedin.com/in/me")];
        assert_eq!(whole_snippet("My LinkedIn.", &s), Some("https://linkedin.com/in/me"));
        assert_eq!(whole_snippet("  “my   linkedin”  ", &s), Some("https://linkedin.com/in/me"));
        assert_eq!(whole_snippet("Here is my LinkedIn.", &s), None);
        assert_eq!(whole_snippet("...", &s), None);
    }

    #[test]
    fn replaces_whole_words_case_insensitively() {
        let r = [rep("wisper flow", "Wispr Flow"), rep("yammer", "Yammer")];
        assert_eq!(apply("I use Wisper Flow and yammer.", &r, &[]), "I use Wispr Flow and Yammer.");
        assert_eq!(apply("yammering is fun", &r, &[]), "yammering is fun");
    }

    #[test]
    fn never_replaces_replaced_text() {
        let r = [rep("flow", "Wispr Flow")];
        assert_eq!(apply("flow", &r, &[]), "Wispr Flow");
        let r = [rep("a", "b"), rep("b", "c")];
        assert_eq!(apply("a b", &r, &[]), "b c");
    }

    #[test]
    fn prefers_the_longest_phrase_and_expands_snippets_inline() {
        let r = [rep("sush", "Sush"), rep("sush pack", "sush-pack")];
        let s = [snip("my email", "me@example.com")];
        assert_eq!(apply("Send sush pack to my email, thanks", &r, &s), "Send sush-pack to me@example.com, thanks");
    }

    #[test]
    fn handles_non_ascii_text() {
        let r = [rep("cafe", "café")];
        assert_eq!(apply("Ünïcode cafe — ok", &r, &[]), "Ünïcode café — ok");
        assert_eq!(apply("", &r, &[]), "");
    }
}
