//! Deterministic text fixes applied to every dictation, with no model involved:
//! dictionary corrections and snippet expansion. Also spots words worth
//! offering to add to the Dictionary.

use std::collections::HashSet;

use crate::settings::{Replacement, Settings, Snippet};

/// At most this many words are offered after one dictation.
const MAX_SUGGESTIONS: usize = 5;

/// Capitalised by grammar or habit, not because they're names or jargon.
const COMMON: &[&str] = &[
    "i",
    "i'm",
    "i'll",
    "i've",
    "i'd",
    "ok",
    "okay",
    "am",
    "pm",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

/// Names, product names, acronyms and jargon in `text` that the Dictionary
/// doesn't know yet: words capitalised mid-sentence ("Kubernetes"), with
/// inner capitals ("OpenAI", "API"), or mixing letters and digits ("GPT4").
/// Neighbouring capitalised words make one phrase ("Wispr Flow"). Words in
/// the vocabulary, turned down before, or written by a correction are skipped.
pub fn suggest_words(text: &str, settings: &Settings) -> Vec<String> {
    let known: HashSet<String> = settings
        .vocabulary_words()
        .into_iter()
        .chain(settings.ignored_words.iter().cloned())
        .chain(settings.replacements.iter().map(|r| r.to.clone()))
        .map(|w| w.trim().to_lowercase())
        .collect();
    let mut out: Vec<String> = Vec::new();
    let mut offer = |run: &mut Vec<&str>| {
        let phrase = run.join(" ");
        let lower = phrase.to_lowercase();
        let all_known = known.contains(&lower) || run.iter().all(|w| known.contains(&w.to_lowercase()));
        if !run.is_empty() && !all_known && !out.iter().any(|o| o.to_lowercase() == lower) {
            out.push(phrase);
        }
        run.clear();
    };

    for line in text.lines() {
        let mut sentence_start = true;
        let mut run = Vec::new();
        for raw in line.split_whitespace() {
            let word = raw.trim_matches(|c: char| !c.is_alphanumeric());
            let word = word.strip_suffix("'s").or_else(|| word.strip_suffix("’s")).unwrap_or(word);
            // URLs and emails come from snippets, not speech.
            let spoken = !raw.contains(['@', '/']);
            if spoken && looks_like_a_name(word, sentence_start) {
                run.push(word);
                if !raw.ends_with(word) {
                    offer(&mut run);
                }
            } else {
                offer(&mut run);
            }
            if !word.is_empty() {
                let end = raw.trim_end_matches(['"', '\'', '”', '’', ')', ']']);
                sentence_start = end.ends_with(['.', '!', '?', ':']);
            }
        }
        offer(&mut run);
    }
    out.truncate(MAX_SUGGESTIONS);
    out
}

fn looks_like_a_name(word: &str, sentence_start: bool) -> bool {
    let mut chars = word.chars();
    let Some(first) = chars.next() else { return false };
    if word.chars().count() < 2 || COMMON.contains(&word.to_lowercase().as_str()) {
        return false;
    }
    let has_upper = word.chars().any(char::is_uppercase);
    let inner_upper = chars.any(char::is_uppercase);
    let mixed = word.chars().any(|c| c.is_ascii_digit()) && word.chars().any(char::is_alphabetic);
    inner_upper || (mixed && has_upper) || (first.is_uppercase() && !sentence_start)
}

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

    fn suggest(text: &str) -> Vec<String> {
        suggest_words(text, &Settings::default())
    }

    #[test]
    fn suggests_names_acronyms_and_jargon() {
        assert_eq!(suggest("We deploy to Kubernetes with OpenAI and GPT4."), ["Kubernetes", "OpenAI", "GPT4"]);
        assert_eq!(suggest("I think we should try Wispr Flow, then Sush's app."), ["Wispr Flow", "Sush"]);
        assert_eq!(suggest("Check the API on AWS and the API again"), ["API", "AWS"]);
    }

    #[test]
    fn skips_sentence_starts_and_ordinary_words() {
        assert!(suggest("Hello there. Today I'm busy! Okay, see you on Monday at 5 PM.").is_empty());
        assert!(suggest("Meeting notes:\nAction items for the 2nd week").is_empty());
        assert!(suggest("Mail me@Example.com or see https://Sush.dev/Docs").is_empty());
    }

    #[test]
    fn skips_known_words() {
        let s = Settings {
            vocabulary: "Kubernetes, wispr".into(),
            ignored_words: vec!["openai".into()],
            replacements: vec![rep("sush pack", "Sush-Pack")],
            ..Settings::default()
        };
        assert!(suggest_words("so Kubernetes and OpenAI and Sush-Pack", &s).is_empty());
        assert_eq!(suggest_words("so Wispr Flow", &s), ["Wispr Flow"]);
    }

    #[test]
    fn handles_non_ascii_text() {
        let r = [rep("cafe", "café")];
        assert_eq!(apply("Ünïcode cafe — ok", &r, &[]), "Ünïcode café — ok");
        assert_eq!(apply("", &r, &[]), "");
    }
}
