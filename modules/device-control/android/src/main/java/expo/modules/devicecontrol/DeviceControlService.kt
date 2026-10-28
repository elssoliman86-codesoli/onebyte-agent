package expo.modules.devicecontrol

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Accessibility service used by the agent. Android only lets it run after the
 * user switches it on manually in system settings, and the user can switch it
 * off there at any time. All calls arrive from the JS side only after the user
 * approved the specific action in the app UI.
 */
class DeviceControlService : AccessibilityService() {
  companion object {
    @Volatile
    var instance: DeviceControlService? = null
    private const val MAX_NODES = 220
  }

  private var nodes: List<AccessibilityNodeInfo> = emptyList()

  /** Public read-only count of the last snapshot's collected nodes (health check). */
  fun nodeCount(): Int = nodes.size

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
  }

  override fun onUnbind(intent: android.content.Intent?): Boolean {
    instance = null
    nodes = emptyList()
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    instance = null
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
  override fun onInterrupt() {}

  /** Numbered text snapshot of the active window. Password text is never included. */
  fun snapshot(): String {
    val root = rootInActiveWindow ?: throw IllegalStateException("لا توجد نافذة نشطة (الشاشة مقفلة أو محمية).")
    val collected = ArrayList<AccessibilityNodeInfo>()
    val lines = StringBuilder()
    lines.append("package=").append(root.packageName ?: "?").append('\n')

    fun walk(node: AccessibilityNodeInfo?) {
      if (node == null || collected.size >= MAX_NODES) return
      if (node.isVisibleToUser) {
        val text = node.text?.toString()?.trim().orEmpty()
        val desc = node.contentDescription?.toString()?.trim().orEmpty()
        val interesting = text.isNotEmpty() || desc.isNotEmpty() || node.isClickable ||
          node.isEditable || node.isScrollable
        if (interesting) {
          val index = collected.size
          collected.add(node)
          val r = Rect()
          node.getBoundsInScreen(r)
          val cls = node.className?.toString()?.substringAfterLast('.') ?: "View"
          lines.append('[').append(index).append("] ").append(cls)
          if (node.isPassword) {
            lines.append(" \"(حقل سري — مخفي)\"")
          } else {
            if (text.isNotEmpty()) lines.append(" \"").append(text.take(200)).append('"')
            if (desc.isNotEmpty() && desc != text) lines.append(" desc=\"").append(desc.take(120)).append('"')
          }
          val id = node.viewIdResourceName
          if (!id.isNullOrEmpty()) lines.append(" id=").append(id.substringAfterLast('/'))
          val flags = ArrayList<String>()
          if (node.isClickable) flags.add("clickable")
          if (node.isEditable) flags.add("editable")
          if (node.isScrollable) flags.add("scrollable")
          if (node.isChecked) flags.add("checked")
          if (flags.isNotEmpty()) lines.append(" {").append(flags.joinToString(",")).append('}')
          lines.append(" @(").append(r.centerX()).append(',').append(r.centerY()).append(")\n")
        }
      }
      for (i in 0 until node.childCount) walk(node.getChild(i))
    }
    walk(root)
    nodes = collected
    if (collected.isEmpty()) lines.append("(لا عناصر مرئية — قد تكون الشاشة محمية)\n")
    return lines.toString()
  }

  private fun nodeAt(index: Int): AccessibilityNodeInfo {
    val node = nodes.getOrNull(index)
      ?: throw IllegalArgumentException("العنصر $index غير موجود. استدعِ get_screen أولًا.")
    // A failed refresh means the node no longer matches the current window content;
    // acting on it could hit the wrong element, so force a fresh snapshot instead.
    if (!node.refresh()) {
      throw IllegalStateException("الشاشة تغيّرت بعد آخر قراءة. استدعِ get_screen ثم أعد المحاولة.")
    }
    return node
  }

  fun tap(index: Int): String {
    val node = nodeAt(index)
    var target: AccessibilityNodeInfo? = node
    while (target != null && !target.isClickable) target = target.parent
    if (target != null && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return "تم الضغط."
    val r = Rect()
    node.getBoundsInScreen(r)
    return if (gestureTap(r.centerX().toFloat(), r.centerY().toFloat())) "تم الضغط (بالإحداثيات)." else
      throw IllegalStateException("فشل الضغط.")
  }

  fun typeText(index: Int, text: String): String {
    val node = nodeAt(index)
    if (node.isPassword) throw SecurityException("ممنوع الكتابة في الحقول السرية.")
    if (!node.isEditable) throw IllegalArgumentException("العنصر ليس حقل كتابة.")
    node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
    val args = Bundle()
    args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
    if (!node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
      throw IllegalStateException("فشلت الكتابة.")
    }
    return "تمت الكتابة."
  }

  fun scroll(down: Boolean): String {
    val scrollable = nodes.filter { it.isScrollable }.maxByOrNull {
      val r = Rect(); it.getBoundsInScreen(r); r.width().toLong() * r.height()
    }
    if (scrollable != null) {
      scrollable.refresh()
      val action = if (down) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
      if (scrollable.performAction(action)) return "تم التمرير."
    }
    val dm = resources.displayMetrics
    val x = dm.widthPixels / 2f
    val from = dm.heightPixels * (if (down) 0.7f else 0.3f)
    val to = dm.heightPixels * (if (down) 0.3f else 0.7f)
    val path = Path().apply { moveTo(x, from); lineTo(x, to) }
    val stroke = GestureDescription.StrokeDescription(path, 0, 300)
    return if (dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null))
      "تم التمرير (بإيماءة)." else throw IllegalStateException("فشل التمرير.")
  }

  fun press(key: String): String {
    val action = when (key) {
      "back" -> GLOBAL_ACTION_BACK
      "home" -> GLOBAL_ACTION_HOME
      "recents" -> GLOBAL_ACTION_RECENTS
      "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
      else -> throw IllegalArgumentException("زر غير معروف.")
    }
    if (!performGlobalAction(action)) throw IllegalStateException("فشل الضغط على $key.")
    return "تم."
  }

  private fun gestureTap(x: Float, y: Float): Boolean {
    val path = Path().apply { moveTo(x, y) }
    val stroke = GestureDescription.StrokeDescription(path, 0, 60)
    return dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
  }
}
