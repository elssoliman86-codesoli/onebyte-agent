package expo.modules.devicecontrol

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DeviceControlModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("لا يوجد سياق للتطبيق.")

  private fun service(): DeviceControlService =
    DeviceControlService.instance
      ?: throw CodedException("خدمة إمكانية الوصول غير مفعّلة. فعّلها من الإعدادات أولًا.")

  override fun definition() = ModuleDefinition {
    Name("DeviceControl")

    Function("isServiceEnabled") { DeviceControlService.instance != null }

    Function("openAccessibilitySettings") {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("openAppDetailsSettings") {
      // The app's own details page — the shortest path to "السماح بالإعدادات المقيدة"
      // on Android 13+ and to the app's accessibility entry on many launchers.
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        .setData(android.net.Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    AsyncFunction("listApps") {
      val pm = context.packageManager
      val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      pm.queryIntentActivities(launcher, 0)
        .map { mapOf("label" to it.loadLabel(pm).toString(), "package" to it.activityInfo.packageName) }
        .distinctBy { it["package"] }
        .sortedBy { it["label"]?.lowercase() }
    }

    AsyncFunction("launchApp") { packageName: String ->
      val intent = context.packageManager.getLaunchIntentForPackage(packageName)
        ?: return@AsyncFunction false
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    AsyncFunction("openUrl") { url: String, packageName: String? ->
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (!packageName.isNullOrEmpty()) intent.setPackage(packageName)
      try {
        context.startActivity(intent)
        true
      } catch (e: Exception) {
        false
      }
    }

    AsyncFunction("getScreen") { service().snapshot() }
    AsyncFunction("tap") { index: Int -> service().tap(index) }
    AsyncFunction("typeText") { index: Int, text: String -> service().typeText(index, text) }
    AsyncFunction("scroll") { down: Boolean -> service().scroll(down) }
    AsyncFunction("press") { key: String -> service().press(key) }

    /**
     * Health check for the accessibility service.
     * Returns true if the service is connected, responsive, and can get a root window.
     */
    AsyncFunction("checkServiceHealth") {
      try {
        val svc = DeviceControlService.instance
        if (svc == null) return@AsyncFunction mapOf<String, Any>("healthy" to false, "reason" to "service_not_connected")
        val root = svc.rootInActiveWindow
        if (root == null) return@AsyncFunction mapOf<String, Any>("healthy" to false, "reason" to "no_active_window")
        // Node count proves the service actually produced a snapshot.
        val count = svc.nodeCount()
        mapOf<String, Any>("healthy" to true, "nodeCount" to count)
      } catch (e: Exception) {
        mapOf<String, Any>("healthy" to false, "reason" to (e.message ?: "unknown_error"))
      }
    }
  }
}
