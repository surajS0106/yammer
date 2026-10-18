fn main() {
    // tauri-build embeds icons/icon.ico into the Windows exe but doesn't tell
    // Cargo to watch it, so a changed icon otherwise keeps the stale one.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
