package expo.modules.meshperipheral

import android.bluetooth.BluetoothAdapter
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class PeripheralOptions : Record {
  @Field var serviceUuid: String = ""
  @Field var rxUuid: String = ""
  @Field var txUuid: String = ""
  /** 16-bit company identifier used for the manufacturer-specific advertisement field. */
  @Field var manufacturerId: Int = 0xFFFF
  /** Base64 payload (short node id) put in the manufacturer-specific field. */
  @Field var manufacturerData: String = ""
  /** AdvertiseSettings.ADVERTISE_MODE_* (0 = low power, 1 = balanced, 2 = low latency). */
  @Field var advertiseMode: Int = 1
  /** AdvertiseSettings.ADVERTISE_TX_POWER_* (0 = ultra low .. 3 = high). */
  @Field var txPowerLevel: Int = 2
}

class MeshPeripheralException(message: String, cause: Throwable? = null) :
  CodedException("ERR_MESH_PERIPHERAL", message, cause)

class MeshPeripheralModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw MeshPeripheralException("React context unavailable")

  override fun definition() = ModuleDefinition {
    Name("MeshPeripheral")

    Events(
      "onCentralSubscribed",
      "onCentralDisconnected",
      "onMtuChanged",
      "onPacket",
      "onAdvertisingStateChanged"
    )

    OnCreate {
      MeshGattServer.emitter = { name, payload -> sendEvent(name, payload) }
    }

    OnDestroy {
      MeshGattServer.emitter = null
      MeshGattServer.stop()
    }

    Function("isPeripheralSupported") { MeshGattServer.isSupported(context) }

    Function("isBluetoothEnabled") { MeshGattServer.isBluetoothEnabled(context) }

    Function("isRunning") { MeshGattServer.isRunning }

    /** Shows the system "Allow app to turn on Bluetooth?" dialog. */
    Function("requestEnableBluetooth") {
      val activity = appContext.currentActivity ?: return@Function false
      try {
        activity.startActivity(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
        true
      } catch (e: SecurityException) {
        false
      }
    }

    AsyncFunction("startPeripheral") { options: PeripheralOptions ->
      try {
        MeshGattServer.start(context, options)
      } catch (e: SecurityException) {
        throw MeshPeripheralException("Missing Bluetooth permission", e)
      } catch (e: Throwable) {
        throw MeshPeripheralException(e.message ?: "Failed to start peripheral", e)
      }
    }

    AsyncFunction("stopPeripheral") { MeshGattServer.stop() }

    Function("setAdvertiseMode") { mode: Int -> MeshGattServer.setAdvertiseMode(mode) }

    /** Sends one frame (base64) to a subscribed central via TX notification. */
    Function("notify") { address: String, base64: String ->
      MeshGattServer.notify(address, Base64.decode(base64, Base64.NO_WRAP))
    }

    Function("disconnectCentral") { address: String -> MeshGattServer.disconnect(address) }

    Function("getSubscribedCentrals") { MeshGattServer.subscribedCentrals() }

    Function("startForegroundService") { title: String, text: String ->
      val ctx = context
      val intent = MeshForegroundService.intent(ctx, MeshForegroundService.ACTION_START, title, text)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
        else ctx.startService(intent)
        true
      } catch (e: Throwable) {
        // e.g. ForegroundServiceStartNotAllowedException when called from background.
        false
      }
    }

    Function("updateForegroundService") { title: String, text: String ->
      if (!MeshForegroundService.isRunning) return@Function false
      val ctx = context
      try {
        ctx.startService(MeshForegroundService.intent(ctx, MeshForegroundService.ACTION_UPDATE, title, text))
        true
      } catch (e: Throwable) {
        false
      }
    }

    Function("stopForegroundService") {
      val ctx = context
      if (MeshForegroundService.isRunning) {
        try {
          ctx.startService(MeshForegroundService.intent(ctx, MeshForegroundService.ACTION_STOP))
        } catch (_: Throwable) {
          ctx.stopService(MeshForegroundService.intent(ctx, MeshForegroundService.ACTION_STOP))
        }
      }
    }
  }
}
