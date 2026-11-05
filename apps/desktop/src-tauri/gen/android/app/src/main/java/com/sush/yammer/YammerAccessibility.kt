package com.sush.yammer

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Pastes into the text box that has focus, the phone's version of desktop's Ctrl+V.
 * It reads the screen only to find that box, when a dictation finishes, and keeps nothing.
 */
class YammerAccessibility : AccessibilityService() {
  override fun onServiceConnected() {
    instance = this
  }

  override fun onUnbind(intent: android.content.Intent?): Boolean {
    instance = null
    return super.onUnbind(intent)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

  override fun onInterrupt() {}

  /** Pastes the clipboard into the focused text box. False if there isn't one. */
  private fun pasteClipboard(): Boolean {
    val node = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
    return node.isEditable && node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
  }

  companion object {
    @Volatile
    private var instance: YammerAccessibility? = null

    fun paste(): Boolean = instance?.pasteClipboard() ?: false
  }
}
