//! Whether the app you're dictating into has a text box focused. With nothing
//! to type into, the paste would land nowhere, so the overlay shows the
//! transcript instead. macOS asks the Accessibility API; elsewhere it's
//! unknown and Yammer pastes as before.

/// `Some(false)` only when the OS says for sure that nothing editable has
/// focus; `None` when it can't tell, which callers treat as "paste anyway".
/// Blocking (an Accessibility round trip to the focused app), so call it off
/// the main thread.
pub fn text_field_focused() -> Option<bool> {
    #[cfg(target_os = "macos")]
    return mac::text_field_focused();
    #[cfg(not(target_os = "macos"))]
    None
}

/// Ask the frontmost app to build its accessibility tree now, at the start of
/// a dictation, so it's there by the time `text_field_focused` asks.
pub fn prime() {
    #[cfg(target_os = "macos")]
    std::thread::spawn(mac::prime);
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::c_void;

    use objc2_foundation::{ns_string, NSString};

    type CFTypeRef = *const c_void;
    type AXError = i32;

    const AX_OK: AXError = 0;
    /// The app has nothing focused (the desktop, an empty Finder window).
    const AX_NO_VALUE: AXError = -25212;
    /// Don't let a hung app stall the paste.
    const TIMEOUT_SECS: f32 = 0.3;
    const TEXT_ROLES: [&str; 4] = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"];

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateSystemWide() -> CFTypeRef;
        fn AXUIElementCopyAttributeValue(element: CFTypeRef, attribute: CFTypeRef, value: *mut CFTypeRef) -> AXError;
        fn AXUIElementSetAttributeValue(element: CFTypeRef, attribute: CFTypeRef, value: CFTypeRef) -> AXError;
        fn AXUIElementIsAttributeSettable(element: CFTypeRef, attribute: CFTypeRef, settable: *mut u8) -> AXError;
        fn AXUIElementSetMessagingTimeout(element: CFTypeRef, seconds: f32) -> AXError;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFBooleanTrue: CFTypeRef;
        fn CFRelease(cf: CFTypeRef);
        fn CFGetTypeID(cf: CFTypeRef) -> usize;
        fn CFStringGetTypeID() -> usize;
    }

    /// A Core Foundation object we own, released on drop.
    struct Owned(CFTypeRef);

    impl Drop for Owned {
        fn drop(&mut self) {
            unsafe { CFRelease(self.0) }
        }
    }

    /// NSString is toll-free bridged to CFString.
    fn cf(name: &NSString) -> CFTypeRef {
        (name as *const NSString).cast()
    }

    fn copy(element: &Owned, attribute: &NSString) -> Result<Owned, AXError> {
        let mut value: CFTypeRef = std::ptr::null();
        match unsafe { AXUIElementCopyAttributeValue(element.0, cf(attribute), &mut value) } {
            AX_OK if !value.is_null() => Ok(Owned(value)),
            AX_OK => Err(AX_NO_VALUE),
            e => Err(e),
        }
    }

    fn string(element: &Owned, attribute: &NSString) -> Option<String> {
        let value = copy(element, attribute).ok()?;
        let is_string = unsafe { CFGetTypeID(value.0) == CFStringGetTypeID() };
        is_string.then(|| unsafe { &*value.0.cast::<NSString>() }.to_string())
    }

    fn settable(element: &Owned, attribute: &NSString) -> bool {
        let mut settable = 0u8;
        unsafe { AXUIElementIsAttributeSettable(element.0, cf(attribute), &mut settable) == AX_OK && settable != 0 }
    }

    fn focused_app() -> Option<Owned> {
        if !crate::platform::accessibility_trusted() {
            return None;
        }
        let system = unsafe { AXUIElementCreateSystemWide() };
        if system.is_null() {
            return None;
        }
        let system = Owned(system);
        unsafe { AXUIElementSetMessagingTimeout(system.0, TIMEOUT_SECS) };
        copy(&system, ns_string!("AXFocusedApplication")).ok()
    }

    pub fn prime() {
        let Some(app) = focused_app() else { return };
        // Electron apps (Slack, VS Code, …) only expose their UI once asked to.
        unsafe { AXUIElementSetAttributeValue(app.0, cf(ns_string!("AXManualAccessibility")), kCFBooleanTrue) };
    }

    pub fn text_field_focused() -> Option<bool> {
        let app = focused_app()?;
        let element = match copy(&app, ns_string!("AXFocusedUIElement")) {
            Ok(element) => element,
            Err(AX_NO_VALUE) => return Some(false),
            Err(_) => return None,
        };
        // An element that won't even say what it is could be anything.
        let role = string(&element, ns_string!("AXRole"))?;
        if TEXT_ROLES.contains(&role.as_str()) {
            return Some(true);
        }
        // Web pages and custom text views: a text selection and a value you can set.
        let editable = copy(&element, ns_string!("AXSelectedTextRange")).is_ok() && settable(&element, ns_string!("AXValue"));
        Some(editable)
    }
}
