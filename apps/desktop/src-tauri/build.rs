fn main() {
    // tauri-build embeds icons/icon.ico into the Windows exe but doesn't tell
    // Cargo to watch it, so a changed icon otherwise keeps the stale one.
    println!("cargo:rerun-if-changed=icons");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        link_clang_runtime();
    }
    tauri_build::build()
}

/// ggml's Metal backend uses `@available`, which calls `__isPlatformVersionAtLeast` from
/// clang's runtime. rustc links with `-nodefaultlibs`, so that library is left out and the
/// release link fails with an undefined symbol unless it's named here.
fn link_clang_runtime() {
    let Ok(out) = std::process::Command::new("cc").arg("--print-runtime-dir").output() else { return };
    let dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let lib = std::path::Path::new(&dir).join("libclang_rt.osx.a");
    if lib.is_file() {
        println!("cargo:rustc-link-arg={}", lib.display());
    }
}
