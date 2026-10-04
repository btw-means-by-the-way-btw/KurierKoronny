package expo.modules.meshperipheral

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import java.io.ByteArrayOutputStream
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Peripheral half of the mesh node.
 *
 * - Hosts a GATT service with two characteristics:
 *     RX (write / write-without-response): remote centrals push mesh frames to us.
 *     TX (notify): we push mesh frames to subscribed centrals.
 * - Advertises the mesh service UUID + a short node id in manufacturer data, so that
 *   scanners can recognise mesh nodes (and deduplicate links) before connecting.
 *
 * Android only allows one outstanding notification per remote device, so outgoing frames
 * are queued per device and released on [BluetoothGattServerCallback.onNotificationSent].
 *
 * NOTE: Android delivers onConnectionStateChange to the GATT server for *every* LE
 * connection, including the ones our own central role opens. A remote is therefore only
 * reported to JS as a peripheral link once it subscribes to TX (CCCD write).
 */
@SuppressLint("MissingPermission")
object MeshGattServer {
  private const val TAG = "MeshGattServer"
  private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
  private const val MAX_QUEUE_PER_DEVICE = 256
  private const val NOTIFY_TIMEOUT_MS = 600L

  /** (eventName, payload) sink, wired to the Expo module's sendEvent. */
  @Volatile var emitter: ((String, Map<String, Any?>) -> Unit)? = null

  private class CentralState(val device: BluetoothDevice) {
    var mtu: Int = 23
    var subscribed = false
    var inFlight = false
    val queue = ArrayDeque<ByteArray>()
    val prepared = ByteArrayOutputStream()
  }

  private val centrals = ConcurrentHashMap<String, CentralState>()
  private val handler = Handler(Looper.getMainLooper())

  private var appContext: Context? = null
  private var gattServer: BluetoothGattServer? = null
  private var txCharacteristic: BluetoothGattCharacteristic? = null
  private var serviceUuid: UUID? = null
  private var rxUuid: UUID? = null
  private var advertising = false
  private var lastOptions: PeripheralOptions? = null

  val isRunning: Boolean get() = gattServer != null

  private fun emit(name: String, payload: Map<String, Any?>) {
    try {
      emitter?.invoke(name, payload)
    } catch (e: Throwable) {
      Log.w(TAG, "emit $name failed", e)
    }
  }

  private fun manager(ctx: Context) =
    ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager

  fun isSupported(ctx: Context): Boolean {
    val adapter = manager(ctx).adapter ?: return false
    return adapter.isMultipleAdvertisementSupported && adapter.bluetoothLeAdvertiser != null
  }

  fun isBluetoothEnabled(ctx: Context): Boolean = manager(ctx).adapter?.isEnabled == true

  // ---------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------

  @Synchronized
  fun start(ctx: Context, options: PeripheralOptions) {
    stop()
    appContext = ctx.applicationContext
    lastOptions = options
    serviceUuid = UUID.fromString(options.serviceUuid)
    rxUuid = UUID.fromString(options.rxUuid)
    val txUuid = UUID.fromString(options.txUuid)

    val btManager = manager(ctx)
    val adapter = btManager.adapter ?: throw IllegalStateException("Bluetooth not available")
    if (!adapter.isEnabled) throw IllegalStateException("Bluetooth is disabled")

    val server = btManager.openGattServer(ctx, callback)
      ?: throw IllegalStateException("Unable to open GATT server")

    val service = BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    val rx = BluetoothGattCharacteristic(
      rxUuid,
      BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
      BluetoothGattCharacteristic.PERMISSION_WRITE
    )
    val tx = BluetoothGattCharacteristic(
      txUuid,
      BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
      BluetoothGattCharacteristic.PERMISSION_READ
    )
    tx.addDescriptor(
      BluetoothGattDescriptor(
        CCCD_UUID,
        BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
      )
    )
    service.addCharacteristic(rx)
    service.addCharacteristic(tx)
    server.addService(service)

    gattServer = server
    txCharacteristic = tx
    startAdvertising(options)
  }

  @Synchronized
  fun stop() {
    stopAdvertising()
    val server = gattServer
    if (server != null) {
      for (state in centrals.values) {
        try { server.cancelConnection(state.device) } catch (_: Throwable) {}
      }
      try { server.clearServices() } catch (_: Throwable) {}
      try { server.close() } catch (_: Throwable) {}
    }
    centrals.clear()
    gattServer = null
    txCharacteristic = null
  }

  // ---------------------------------------------------------------------------------------
  // Advertising
  // ---------------------------------------------------------------------------------------

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
      advertising = true
      emit("onAdvertisingStateChanged", mapOf("advertising" to true, "error" to null))
    }

    override fun onStartFailure(errorCode: Int) {
      if (errorCode == ADVERTISE_FAILED_ALREADY_STARTED) {
        advertising = true
        return
      }
      advertising = false
      emit(
        "onAdvertisingStateChanged",
        mapOf("advertising" to false, "error" to "Advertising failed (code $errorCode)")
      )
    }
  }

  private fun startAdvertising(options: PeripheralOptions) {
    val ctx = appContext ?: return
    val advertiser = manager(ctx).adapter?.bluetoothLeAdvertiser
    if (advertiser == null) {
      emit(
        "onAdvertisingStateChanged",
        mapOf("advertising" to false, "error" to "BLE advertising not supported on this device")
      )
      return
    }
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(options.advertiseMode.coerceIn(0, 2))
      .setTxPowerLevel(options.txPowerLevel.coerceIn(0, 3))
      .setConnectable(true)
      .setTimeout(0)
      .build()

    // 3 (flags) + 18 (128-bit UUID) + 2+2+N (manufacturer data) must fit in 31 bytes.
    val manufacturerBytes = android.util.Base64.decode(options.manufacturerData, android.util.Base64.NO_WRAP)
    val data = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .setIncludeTxPowerLevel(false)
      .addServiceUuid(ParcelUuid(serviceUuid))
      .addManufacturerData(options.manufacturerId, manufacturerBytes)
      .build()

    try {
      advertiser.startAdvertising(settings, data, advertiseCallback)
    } catch (e: SecurityException) {
      emit("onAdvertisingStateChanged", mapOf("advertising" to false, "error" to "Missing BLUETOOTH_ADVERTISE permission"))
    }
  }

  private fun stopAdvertising() {
    val ctx = appContext ?: return
    try {
      manager(ctx).adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
    } catch (_: Throwable) {}
    if (advertising) {
      advertising = false
      emit("onAdvertisingStateChanged", mapOf("advertising" to false, "error" to null))
    }
  }

  /** Re-applies advertising with a different power/latency trade-off (foreground vs background). */
  @Synchronized
  fun setAdvertiseMode(mode: Int) {
    val opts = lastOptions ?: return
    if (gattServer == null) return
    opts.advertiseMode = mode
    stopAdvertising()
    startAdvertising(opts)
  }

  // ---------------------------------------------------------------------------------------
  // Outgoing notifications
  // ---------------------------------------------------------------------------------------

  /** Queues [value] for [address]. Returns false if the device is unknown or its queue is full. */
  fun notify(address: String, value: ByteArray): Boolean {
    val state = centrals[address] ?: return false
    if (!state.subscribed) return false
    synchronized(state) {
      if (state.queue.size >= MAX_QUEUE_PER_DEVICE) return false
      state.queue.add(value)
    }
    pump(state)
    return true
  }

  private fun pump(state: CentralState) {
    val server = gattServer ?: return
    val tx = txCharacteristic ?: return
    val next: ByteArray
    synchronized(state) {
      if (state.inFlight) return
      next = state.queue.poll() ?: return
      state.inFlight = true
    }
    val ok = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        server.notifyCharacteristicChanged(state.device, tx, false, next) == BluetoothGatt.GATT_SUCCESS
      } else {
        @Suppress("DEPRECATION")
        tx.value = next
        @Suppress("DEPRECATION")
        server.notifyCharacteristicChanged(state.device, tx, false)
      }
    } catch (e: Throwable) {
      Log.w(TAG, "notify failed", e)
      false
    }
    if (!ok) {
      synchronized(state) { state.inFlight = false }
      return
    }
    // Some stacks never call onNotificationSent – don't let the queue stall forever.
    val address = state.device.address
    handler.postDelayed({
      val current = centrals[address] ?: return@postDelayed
      if (current === state && state.inFlight) {
        synchronized(state) { state.inFlight = false }
        pump(state)
      }
    }, NOTIFY_TIMEOUT_MS)
  }

  fun disconnect(address: String) {
    val state = centrals[address] ?: return
    try { gattServer?.cancelConnection(state.device) } catch (_: Throwable) {}
  }

  fun subscribedCentrals(): List<Map<String, Any>> =
    centrals.values.filter { it.subscribed }.map { mapOf("address" to it.device.address, "mtu" to it.mtu) }

  // ---------------------------------------------------------------------------------------
  // GATT server callback
  // ---------------------------------------------------------------------------------------

  private fun respond(device: BluetoothDevice, requestId: Int, status: Int, offset: Int, value: ByteArray?) {
    try { gattServer?.sendResponse(device, requestId, status, offset, value) } catch (_: Throwable) {}
  }

  private val callback = object : BluetoothGattServerCallback() {
    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      val address = device.address
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        centrals.getOrPut(address) { CentralState(device) }
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        val removed = centrals.remove(address)
        if (removed?.subscribed == true) {
          emit("onCentralDisconnected", mapOf("address" to address))
        }
      }
    }

    override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
      val state = centrals.getOrPut(device.address) { CentralState(device) }
      state.mtu = mtu
      emit("onMtuChanged", mapOf("address" to device.address, "mtu" to mtu))
    }

    override fun onCharacteristicReadRequest(
      device: BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic
    ) {
      respond(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, ByteArray(0))
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice,
      requestId: Int,
      characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?
    ) {
      if (characteristic.uuid != rxUuid) {
        if (responseNeeded) respond(device, requestId, BluetoothGatt.GATT_WRITE_NOT_PERMITTED, offset, null)
        return
      }
      val state = centrals.getOrPut(device.address) { CentralState(device) }
      val bytes = value ?: ByteArray(0)
      if (preparedWrite) {
        // Long write: buffer until onExecuteWrite.
        synchronized(state) { state.prepared.write(bytes) }
      } else {
        emitPacket(device.address, bytes)
      }
      if (responseNeeded) respond(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, bytes)
    }

    override fun onExecuteWrite(device: BluetoothDevice, requestId: Int, execute: Boolean) {
      val state = centrals[device.address]
      if (state != null) {
        val bytes: ByteArray
        synchronized(state) {
          bytes = state.prepared.toByteArray()
          state.prepared.reset()
        }
        if (execute && bytes.isNotEmpty()) emitPacket(device.address, bytes)
      }
      respond(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
    }

    override fun onDescriptorReadRequest(
      device: BluetoothDevice, requestId: Int, offset: Int, descriptor: BluetoothGattDescriptor
    ) {
      val subscribed = centrals[device.address]?.subscribed == true
      val value = if (subscribed) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
      else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
      respond(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice,
      requestId: Int,
      descriptor: BluetoothGattDescriptor,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?
    ) {
      if (descriptor.uuid == CCCD_UUID) {
        val state = centrals.getOrPut(device.address) { CentralState(device) }
        val enable = value != null && value.isNotEmpty() && (value[0].toInt() and 0x01) != 0
        if (enable && !state.subscribed) {
          state.subscribed = true
          emit("onCentralSubscribed", mapOf("address" to device.address, "mtu" to state.mtu))
        } else if (!enable && state.subscribed) {
          state.subscribed = false
          synchronized(state) { state.queue.clear(); state.inFlight = false }
          emit("onCentralDisconnected", mapOf("address" to device.address))
        }
      }
      if (responseNeeded) respond(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
    }

    override fun onNotificationSent(device: BluetoothDevice, status: Int) {
      val state = centrals[device.address] ?: return
      synchronized(state) { state.inFlight = false }
      pump(state)
    }
  }

  private fun emitPacket(address: String, bytes: ByteArray) {
    if (bytes.isEmpty()) return
    emit(
      "onPacket",
      mapOf("address" to address, "data" to android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
    )
  }
}
