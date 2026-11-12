//! Android's update check. The desktop app's updater reads `latest.json` from the
//! latest GitHub release, but Android is released separately, as `android-v<version>`
//! releases that are never "latest", so the phone looks through the releases list instead.

use serde::Serialize;
use serde_json::Value;

/// Where an Android release's tag starts.
pub const ANDROID_TAG: &str = "android-v";

/// A newer Android release than the one running.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidRelease {
    pub version: String,
    /// The release body: that version's section of CHANGELOG-android.md.
    pub notes: String,
    /// The APK to download.
    pub url: String,
}

/// The newest published Android release with an APK, if it's newer than `current`.
/// `releases` is GitHub's `GET /repos/{owner}/{repo}/releases` answer.
pub fn newer_android(releases: &Value, current: &str) -> Option<AndroidRelease> {
    releases
        .as_array()?
        .iter()
        .filter(|r| !r["draft"].as_bool().unwrap_or(false) && !r["prerelease"].as_bool().unwrap_or(false))
        .filter_map(|r| {
            let version = r["tag_name"].as_str()?.strip_prefix(ANDROID_TAG)?;
            let url = r["assets"].as_array()?.iter().find_map(|a| {
                let name = a["name"].as_str()?;
                name.ends_with(".apk").then(|| a["browser_download_url"].as_str()).flatten()
            })?;
            Some(AndroidRelease { version: version.to_string(), notes: r["body"].as_str().unwrap_or_default().to_string(), url: url.to_string() })
        })
        .max_by(|a, b| parse(&a.version).cmp(&parse(&b.version)))
        .filter(|r| parse(&r.version) > parse(current))
}

/// "1.10.2" as numbers, so 1.10 sorts after 1.9. Anything after a `-` is ignored.
fn parse(version: &str) -> Vec<u64> {
    version.split('-').next().unwrap_or_default().split('.').map(|p| p.trim().parse().unwrap_or(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn release(tag: &str, apk: Option<&str>) -> Value {
        let assets: Vec<Value> = apk.map(|n| json!({ "name": n, "browser_download_url": format!("https://x/{tag}/{n}") })).into_iter().collect();
        json!({ "tag_name": tag, "draft": false, "prerelease": false, "body": format!("notes for {tag}"), "assets": assets })
    }

    #[test]
    fn finds_the_newest_android_release() {
        let releases = json!([
            release("v0.9.0", Some("Yammer_0.9.0_x64.msi")),
            release("android-v0.10.0", Some("Yammer_0.10.0_android.apk")),
            release("android-v0.9.1", Some("Yammer_0.9.1_android.apk")),
        ]);
        let found = newer_android(&releases, "0.7.0").unwrap();
        assert_eq!(found.version, "0.10.0");
        assert_eq!(found.url, "https://x/android-v0.10.0/Yammer_0.10.0_android.apk");
        assert_eq!(found.notes, "notes for android-v0.10.0");
    }

    #[test]
    fn nothing_when_up_to_date_or_without_an_apk() {
        let releases = json!([release("android-v0.7.0", Some("Yammer_0.7.0_android.apk")), release("android-v0.8.0", None)]);
        assert_eq!(newer_android(&releases, "0.7.0"), None);
        assert_eq!(newer_android(&releases, "0.10.0"), None);
    }

    #[test]
    fn skips_drafts_and_prereleases() {
        let mut draft = release("android-v0.9.0", Some("a.apk"));
        draft["draft"] = json!(true);
        let mut pre = release("android-v0.8.0", Some("b.apk"));
        pre["prerelease"] = json!(true);
        assert_eq!(newer_android(&json!([draft, pre]), "0.7.0"), None);
        assert_eq!(newer_android(&json!({ "message": "rate limited" }), "0.7.0"), None);
    }
}
