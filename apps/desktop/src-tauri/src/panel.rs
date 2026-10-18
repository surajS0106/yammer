//! macOS: the overlay follows you to every Space, including other apps' full-screen ones.
//! Larp has a Dock icon, so it's a regular app, and macOS keeps a regular app's
//! windows out of other apps' full-screen Spaces. A non-activating panel can go there.
//! Tauri has no panels, so this turns tao's window into one in place: it swaps the
//! window's class for an `NSPanel` subclass that copies tao's overrides and ivar.

use std::ffi::CStr;
use std::sync::OnceLock;

use objc2::ffi;
use objc2::runtime::{AnyClass, AnyObject, Sel};
use objc2::{msg_send, sel, ClassType, MainThreadMarker};
use objc2_app_kit::{NSPanel, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask};
use tauri::WebviewWindow;

const PANEL_CLASS: &CStr = c"LarpOverlayPanel";
const FOCUSABLE: &CStr = c"focusable";

/// Call from the main thread, once, right after the window is built.
pub fn make_panel(window: &WebviewWindow) {
    if MainThreadMarker::new().is_none() {
        return;
    }
    let Ok(ptr) = window.ns_window() else { return };
    let obj = ptr.cast::<AnyObject>();
    unsafe {
        let is_panel = match panel_class(&*ffi::object_getClass(obj)) {
            Some(panel) => {
                ffi::object_setClass(obj, panel);
                true
            }
            None => false,
        };
        let ns_window = &*ptr.cast::<NSWindow>();
        if is_panel {
            let panel = &*ptr.cast::<NSPanel>();
            panel.setStyleMask(panel.styleMask() | NSWindowStyleMask::NonactivatingPanel);
            panel.setFloatingPanel(true);
            // Panels hide when their app isn't frontmost, which Larp almost never is.
            panel.setHidesOnDeactivate(false);
        }
        ns_window.setCollectionBehavior(
            ns_window.collectionBehavior()
                | NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
    }
}

/// Keep the webview drawing while the window is covered. WebKit treats an occluded
/// window's page as hidden and drops its contents, and macOS reports the overlay
/// as occluded for a moment on every Space switch, so Sushi blinked out and back.
pub fn keep_rendering(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        let Some(webview) = webview.inner().cast::<AnyObject>().as_ref() else { return };
        let sel = sel!(_setWindowOcclusionDetectionEnabled:);
        // A private WebKit setting, so check it's still there.
        let supported: bool = msg_send![webview, respondsToSelector: sel];
        if supported {
            let _: () = msg_send![webview, _setWindowOcclusionDetectionEnabled: false];
        }
    });
}

/// An `NSPanel` subclass laid out like tao's `TaoWindow`, or `None` if the two
/// don't line up (then the window stays as it is rather than risk memory errors).
fn panel_class(tao: &AnyClass) -> Option<&'static AnyClass> {
    static CLASS: OnceLock<Option<usize>> = OnceLock::new();
    let class = *CLASS.get_or_init(|| unsafe { build(tao) }.map(|c| c as *const AnyClass as usize));
    class.map(|c| unsafe { &*(c as *const AnyClass) })
}

unsafe fn build(tao: &AnyClass) -> Option<&'static AnyClass> {
    let tao_ivar = ffi::class_getInstanceVariable(tao, FOCUSABLE.as_ptr());
    if tao_ivar.is_null() {
        return None;
    }
    let cls = ffi::objc_allocateClassPair(NSPanel::class(), PANEL_CLASS.as_ptr(), 0);
    if cls.is_null() {
        return None;
    }
    let encoding = ffi::ivar_getTypeEncoding(tao_ivar);
    if !ffi::class_addIvar(cls, FOCUSABLE.as_ptr(), 1, 0, encoding).as_bool() {
        return None;
    }
    ffi::objc_registerClassPair(cls);
    let cls: &'static AnyClass = &*cls;

    // canBecomeKeyWindow/MainWindow read the ivar; sendEvent: drags the window.
    let methods: [Sel; 3] = [sel!(canBecomeMainWindow), sel!(canBecomeKeyWindow), sel!(sendEvent:)];
    for sel in methods {
        let method = ffi::class_getInstanceMethod(tao, sel);
        let Some(imp) = (!method.is_null()).then(|| ffi::method_getImplementation(method)).flatten() else {
            return None;
        };
        ffi::class_addMethod(cls as *const _ as *mut _, sel, imp, ffi::method_getTypeEncoding(method));
    }

    let panel_ivar = ffi::class_getInstanceVariable(cls, FOCUSABLE.as_ptr());
    let same_layout = ffi::class_getInstanceSize(cls) == ffi::class_getInstanceSize(tao)
        && ffi::ivar_getOffset(panel_ivar) == ffi::ivar_getOffset(tao_ivar);
    same_layout.then_some(cls)
}
