package com.sush.yammer

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Pastes into the text box that has focus, the phone's version of desktop's Ctrl+V.
 * It reads the screen only to find that box, when a dictation finishes, and keeps nothing.
 *
 * Google Pay, and some bank apps, refuse to work while an Accessibility service from an app that
 * wasn't installed from the Play Store is on, and may make you reset your UPI PIN after. So it can
 * switch itself off ([turnOff]) from the app or the notification, before you pay; switching it back
 * on is up to the user in Android's Accessibility settings, as no app may do that.
 */
class YammerAccessibility : AccessibilityService() {
  override fun onServiceConnected() {
    instance = this
    // Its notification offers "Stop pasting" while this is on.
    YammerService.instance?.refreshNotification()
  }

  override fun onUnbind(intent: android.content.Intent?): Boolean {
    instance = null
    return super.onUnbind(intent)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

  override fun onInterrupt() {}

  /** Pastes the clipboard into the focused text box. False if there isn't one, or it's a password field. */
  private fun pasteClipboard(): Boolean {
    val node = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
    // Never type into a password field for anyone: the text is left to paste by hand.
    if (node.isPassword) return false
    return node.isEditable && node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
  }

  companion object {
    @Volatile
    private var instance: YammerAccessibility? = null

    fun paste(): Boolean = instance?.pasteClipboard() ?: false

    /** Connected right now, so it can be switched off from here. */
    val isOn: Boolean get() = instance != null

    /** Switch the service off, as if the user had in Accessibility settings. False if it wasn't on. */
    fun turnOff(): Boolean {
      val service = instance ?: return false
      service.disableSelf()
      instance = null
      return true
    }
  }
}
