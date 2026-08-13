package expo.modules.maxpowerhealthconnect

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.util.Base64
import java.io.Serializable
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import org.json.JSONArray
import org.json.JSONObject

/**
 * Android-only bridge for Health Connect availability and progressive read
 * permission. It returns only primitive data; shared TypeScript never imports
 * Health Connect SDK classes.
 *
 * `readEvidencePageAsync` returns one bounded provider page. Its opaque cursor
 * records a single active record type, initial-page token or Changes tokens;
 * it never persists itself. CoachApplication advances it only in the same
 * AtomicCommit as normalized Timeline evidence.
 */
class MaxPowerHealthConnectModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private lateinit var permissionLauncher: AppContextActivityResultLauncher<HealthConnectPermissionInput, Set<String>>

  override fun definition() = ModuleDefinition {
    Name("MaxPowerHealthConnect")

    RegisterActivityContracts {
      permissionLauncher = registerForActivityResult(HealthConnectPermissionContract())
    }

    AsyncFunction("getAvailabilityAsync") {
      availability(context)
    }

    AsyncFunction("getPermissionStateAsync") Coroutine { metricTypes: List<String> ->
      permissionState(metricTypes)
    }

    AsyncFunction("requestPermissionsAsync") Coroutine { metricTypes: List<String> ->
      if (availability(context) != AVAILABLE) return@Coroutine unsupportedPermissionState(metricTypes)
      val permissions = permissionsFor(metricTypes)
      if (permissions.isEmpty()) return@Coroutine unsupportedPermissionState(metricTypes)
      requestedPreferences().edit().apply {
        metricTypes.filter { permissionFor(it) != null }.forEach { putBoolean("requested:$it", true) }
      }.apply()
      val granted = permissionLauncher.launch(HealthConnectPermissionInput(permissions.toList()))
      permissionState(metricTypes, granted)
    }

    AsyncFunction("readEvidencePageAsync") Coroutine { metricTypes: List<String>, cursor: String? ->
      readEvidencePage(metricTypes, cursor)
    }
  }

  private suspend fun permissionState(
    metricTypes: List<String>,
    knownGranted: Set<String>? = null,
  ): Map<String, String> {
    if (availability(context) != AVAILABLE) return unsupportedPermissionState(metricTypes)
    val granted = knownGranted ?: HealthConnectClient.getOrCreate(context)
      .permissionController
      .getGrantedPermissions()
    val preferences = requestedPreferences()
    return metricTypes.associateWith { metric ->
      when (val permission = permissionFor(metric)) {
        null -> NOT_SUPPORTED
        in granted -> GRANTED
        else -> if (preferences.getBoolean("requested:$metric", false)) DENIED else NOT_REQUESTED
      }
    }
  }

  private fun requestedPreferences() = context.getSharedPreferences(PREFERENCE_NAME, Context.MODE_PRIVATE)

  private fun permissionsFor(metricTypes: List<String>): Set<String> = metricTypes.mapNotNull(::permissionFor).toSet()

  private fun permissionFor(metric: String): String? = when (metric) {
    "sleep" -> HealthPermission.getReadPermission(SleepSessionRecord::class)
    "hrv_rmssd" -> HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class)
    "resting_heart_rate" -> HealthPermission.getReadPermission(RestingHeartRateRecord::class)
    "activity" -> HealthPermission.getReadPermission(ExerciseSessionRecord::class)
    "body_weight" -> HealthPermission.getReadPermission(WeightRecord::class)
    "body_fat_percentage" -> HealthPermission.getReadPermission(BodyFatRecord::class)
    // Android Health Connect does not expose SDNN in this supported record set.
    else -> null
  }

  private fun unsupportedPermissionState(metricTypes: List<String>): Map<String, String> =
    metricTypes.associateWith { NOT_SUPPORTED }

  private fun availability(context: Context): String = when (HealthConnectClient.getSdkStatus(context)) {
    HealthConnectClient.SDK_AVAILABLE -> AVAILABLE
    HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> PROVIDER_UPDATE_REQUIRED
    else -> NOT_SUPPORTED
  }

  /**
   * Reads one page only. This preserves cancellation opportunities and avoids
   * accumulating a long Health Connect history on the UI thread. Initial
   * imports are deliberately bounded to the default 30-day read window; a
   * separate, explained historical-consent flow is required before widening it.
   */
  private suspend fun readEvidencePage(rawMetricTypes: List<String>, rawCursor: String?): Map<String, Any> {
    if (availability(context) != AVAILABLE) throw HealthConnectUnavailableException()
    val metricTypes = rawMetricTypes.distinct().filter { permissionFor(it) != null }.sorted()
    if (metricTypes.isEmpty()) return mapOf("evidence" to emptyList<Map<String, Any>>())
    val granted = HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()
    if (metricTypes.any { metric -> permissionFor(metric)?.let { it !in granted } ?: true }) {
      throw HealthConnectPermissionMissingException()
    }

    val client = HealthConnectClient.getOrCreate(context)
    val state = HealthConnectCursor.decode(rawCursor)?.takeIf { it.metricTypes == metricTypes }
      ?: HealthConnectCursor.initial(metricTypes)
    val observedAt = Instant.now().toString()
    val page = when (state.phase) {
      CURSOR_PHASE_INITIAL -> readInitialPage(client, state, observedAt)
      CURSOR_PHASE_CHANGES -> readChangesPage(client, state, observedAt)
      else -> readInitialPage(client, HealthConnectCursor.initial(metricTypes), observedAt)
    }
    return buildMap {
      put("evidence", page.evidence)
      put("nextCursor", page.next.encode())
      if (page.cursorReset) put("cursorReset", true)
      if (page.hasMore) put("hasMore", true)
      if (page.initialSyncPending) put("initialSyncPending", true)
    }
  }

  private suspend fun readInitialPage(
    client: HealthConnectClient,
    state: HealthConnectCursor,
    observedAt: String,
  ): NativeEvidencePage {
    val metric = state.currentMetric()
    val response = initialRecords(client, metric, state.initialPageToken)
    val evidence = response.records.flatMap { normalizeRecord(it, metric, observedAt) }
    val next = if (response.nextPageToken != null) {
      state.copy(initialPageToken = response.nextPageToken)
    } else if (state.index + 1 < state.metricTypes.size) {
      state.copy(index = state.index + 1, initialPageToken = null)
    } else {
      HealthConnectCursor(phase = CURSOR_PHASE_CHANGES, metricTypes = state.metricTypes, index = 0)
    }
    return NativeEvidencePage(
      evidence = evidence,
      next = next,
      initialSyncPending = next.phase == CURSOR_PHASE_INITIAL,
      // Once the bounded initial import completes, walk each enabled changes
      // token at least once in the same catch-up run. Later runs stop after a
      // clean per-type page unless Health Connect reports a backlog.
      hasMore = next.phase == CURSOR_PHASE_INITIAL ||
        (next.phase == CURSOR_PHASE_CHANGES && next.changeTokens.size < next.metricTypes.size),
    )
  }

  private suspend fun readChangesPage(
    client: HealthConnectClient,
    state: HealthConnectCursor,
    observedAt: String,
  ): NativeEvidencePage {
    val metric = state.currentMetric()
    val token = state.changeTokens[metric] ?: client.getChangesToken(tokenRequest(metric))
    return try {
      val response = client.getChanges(token)
      val evidence = response.changes.flatMap { change ->
        when (change) {
          is UpsertionChange -> {
            val record = change.record
            // MaxPower does not write Health Connect records in this MVP. This
            // guard prevents a future write feature from importing its own copy.
            if (record.metadata.dataOrigin.packageName == context.packageName) emptyList()
            else normalizeRecord(record, metric, observedAt)
          }
          is DeletionChange -> listOf(mapOf(
            "id" to change.recordId,
            "metric" to metric,
            "observedAt" to observedAt,
            "change" to "delete",
          ))
          else -> emptyList()
        }
      }
      val tokens = state.changeTokens + (metric to response.nextChangesToken)
      val next = state.copy(
        index = if (response.hasMore) state.index else (state.index + 1) % state.metricTypes.size,
        changeTokens = tokens,
      )
      NativeEvidencePage(
        evidence = evidence,
        next = next,
        hasMore = response.hasMore || next.changeTokens.size < next.metricTypes.size,
      )
    } catch (error: Exception) {
      // AndroidX changes-token expiry has varied in package/name across
      // releases. Only that explicit condition resets to a bounded initial
      // resync; all other provider errors propagate and preserve local facts.
      if (error.javaClass.simpleName.contains("ChangesTokenExpired", ignoreCase = true)) {
        NativeEvidencePage(emptyList(), HealthConnectCursor.initial(state.metricTypes), cursorReset = true)
      } else {
        throw error
      }
    }
  }

  private suspend fun initialRecords(
    client: HealthConnectClient,
    metric: String,
    pageToken: String?,
  ): RawRecordPage {
    val now = Instant.now()
    val range = TimeRangeFilter.between(now.minus(INITIAL_IMPORT_WINDOW), now)
    return when (metric) {
      "sleep" -> client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, range, pageSize = READ_PAGE_SIZE, pageToken = pageToken))
        .let { RawRecordPage(it.records, it.pageToken) }
      "hrv_rmssd" -> client.readRecords(ReadRecordsRequest(HeartRateVariabilityRmssdRecord::class, range, pageSize = READ_PAGE_SIZE, pageToken = pageToken))
        .let { RawRecordPage(it.records, it.pageToken) }
      "resting_heart_rate" -> client.readRecords(ReadRecordsRequest(RestingHeartRateRecord::class, range, pageSize = READ_PAGE_SIZE, pageToken = pageToken))
        .let { RawRecordPage(it.records, it.pageToken) }
      "activity" -> client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, range, pageSize = READ_PAGE_SIZE, pageToken = pageToken))
        .let { RawRecordPage(it.records, it.pageToken) }
      "body_weight" -> client.readRecords(ReadRecordsRequest(WeightRecord::class, range, pageSize = READ_PAGE_SIZE, pageToken = pageToken))
        .let { RawRecordPage(it.records, it.pageToken) }
      "body_fat_percentage" -> client.readRecords(ReadRecordsRequest(BodyFatRecord::class, range, pageSize = READ_PAGE_SIZE, pageToken = pageToken))
        .let { RawRecordPage(it.records, it.pageToken) }
      else -> RawRecordPage(emptyList(), null)
    }
  }

  private fun tokenRequest(metric: String): ChangesTokenRequest = when (metric) {
    "sleep" -> ChangesTokenRequest(recordTypes = setOf(SleepSessionRecord::class))
    "hrv_rmssd" -> ChangesTokenRequest(recordTypes = setOf(HeartRateVariabilityRmssdRecord::class))
    "resting_heart_rate" -> ChangesTokenRequest(recordTypes = setOf(RestingHeartRateRecord::class))
    "activity" -> ChangesTokenRequest(recordTypes = setOf(ExerciseSessionRecord::class))
    "body_weight" -> ChangesTokenRequest(recordTypes = setOf(WeightRecord::class))
    "body_fat_percentage" -> ChangesTokenRequest(recordTypes = setOf(BodyFatRecord::class))
    else -> throw IllegalArgumentException("Unsupported Health Connect metric: $metric")
  }

  private fun normalizeRecord(record: Record, expectedMetric: String, observedAt: String): List<Map<String, Any>> = when (record) {
    is SleepSessionRecord -> if (expectedMetric == "sleep") listOf(intervalEvidence(record, "sleep", observedAt, durationMinutes(record.startTime, record.endTime))) else emptyList()
    is HeartRateVariabilityRmssdRecord -> if (expectedMetric == "hrv_rmssd") listOf(instantEvidence(record, "hrv_rmssd", observedAt, record.heartRateVariabilityMillis, "milliseconds", record.time, record.zoneOffset)) else emptyList()
    is RestingHeartRateRecord -> if (expectedMetric == "resting_heart_rate") listOf(instantEvidence(record, "resting_heart_rate", observedAt, record.beatsPerMinute.toDouble(), "beats_per_minute", record.time, record.zoneOffset)) else emptyList()
    is ExerciseSessionRecord -> if (expectedMetric == "activity") listOf(intervalEvidence(record, "activity", observedAt, durationMinutes(record.startTime, record.endTime))) else emptyList()
    is WeightRecord -> if (expectedMetric == "body_weight") listOf(instantEvidence(record, "body_weight", observedAt, record.weight.inKilograms, "kg", record.time, record.zoneOffset)) else emptyList()
    is BodyFatRecord -> if (expectedMetric == "body_fat_percentage") listOf(instantEvidence(record, "body_fat_percentage", observedAt, record.percentage.value, "percent", record.time, record.zoneOffset)) else emptyList()
    else -> emptyList()
  }

  private fun instantEvidence(
    record: Record,
    metric: String,
    observedAt: String,
    value: Double,
    unit: String,
    time: Instant,
    zoneOffset: ZoneOffset?,
  ): Map<String, Any> = commonEvidence(record, metric, observedAt).apply {
    put("value", value)
    put("unit", unit)
    put("occurredAt", time.toString())
    zoneOffsetMinutes(zoneOffset)?.let { put("timezoneOffsetMinutes", it) }
  }

  private fun intervalEvidence(
    record: Record,
    metric: String,
    observedAt: String,
    durationMinutes: Double,
  ): Map<String, Any> {
    // Do not let Kotlin infer AndroidX's internal IntervalRecord supertype.
    // Health Connect intentionally exposes the concrete public record classes,
    // so copy the three public fields through an exhaustive public-type branch.
    val (startTime, endTime, startZoneOffset) = when (record) {
      is SleepSessionRecord -> Triple(record.startTime, record.endTime, record.startZoneOffset)
      is ExerciseSessionRecord -> Triple(record.startTime, record.endTime, record.startZoneOffset)
      else -> throw IllegalArgumentException("Expected interval record")
    }
    return commonEvidence(record, metric, observedAt).apply {
      put("value", durationMinutes)
      put("unit", "minutes")
      put("occurredAt", startTime.toString())
      put("endedAt", endTime.toString())
      zoneOffsetMinutes(startZoneOffset)?.let { put("timezoneOffsetMinutes", it) }
    }
  }

  private fun commonEvidence(record: Record, metric: String, observedAt: String): MutableMap<String, Any> {
    val metadata = record.metadata
    return mutableMapOf<String, Any>(
      "id" to metadata.id,
      "metric" to metric,
      "observedAt" to observedAt,
      "dataOriginPackage" to metadata.dataOrigin.packageName,
      "lastModifiedAt" to metadata.lastModifiedTime.toString(),
      "recordingMethod" to recordingMethodName(metadata.recordingMethod),
      "clientRecordVersion" to metadata.clientRecordVersion.toString(),
    ).apply {
      metadata.clientRecordId?.let { put("clientRecordId", it) }
      metadata.device?.let { device ->
        device.manufacturer?.let { put("deviceManufacturer", it) }
        device.model?.let { put("deviceModel", it) }
        put("deviceType", device.type.toString())
      }
    }
  }

  private fun durationMinutes(start: Instant, end: Instant): Double = Duration.between(start, end).toMillis().toDouble() / 60_000.0
  private fun zoneOffsetMinutes(offset: ZoneOffset?): Int? = offset?.totalSeconds?.div(60)

  private fun recordingMethodName(value: Int): String = when (value) {
    androidx.health.connect.client.records.metadata.Metadata.RECORDING_METHOD_ACTIVELY_RECORDED -> "actively_recorded"
    androidx.health.connect.client.records.metadata.Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED -> "automatically_recorded"
    androidx.health.connect.client.records.metadata.Metadata.RECORDING_METHOD_MANUAL_ENTRY -> "manual_entry"
    else -> "unknown"
  }

  private companion object {
    const val PREFERENCE_NAME = "maxpower.health-connect.permission-state.v1"
    const val AVAILABLE = "available"
    const val NOT_SUPPORTED = "not_supported"
    const val PROVIDER_UPDATE_REQUIRED = "provider_missing_or_update_required"
    const val GRANTED = "granted"
    const val DENIED = "denied"
    const val NOT_REQUESTED = "not_requested"
    const val CURSOR_PHASE_INITIAL = "initial"
    const val CURSOR_PHASE_CHANGES = "changes"
    const val READ_PAGE_SIZE = 100
    val INITIAL_IMPORT_WINDOW: Duration = Duration.ofDays(30)
  }
}

private data class RawRecordPage(val records: List<Record>, val nextPageToken: String?)
private data class NativeEvidencePage(
  val evidence: List<Map<String, Any>>,
  val next: HealthConnectCursor,
  val cursorReset: Boolean = false,
  val hasMore: Boolean = false,
  val initialSyncPending: Boolean = false,
)

private data class HealthConnectCursor(
  val phase: String,
  val metricTypes: List<String>,
  val index: Int,
  val initialPageToken: String? = null,
  val changeTokens: Map<String, String> = emptyMap(),
) {
  fun currentMetric(): String = metricTypes[index.coerceIn(0, metricTypes.lastIndex)]

  fun encode(): String {
    val json = JSONObject().apply {
      put("version", 1)
      put("phase", phase)
      put("metricTypes", JSONArray(metricTypes))
      put("index", index)
      initialPageToken?.let { put("initialPageToken", it) }
      put("changeTokens", JSONObject(changeTokens))
    }
    return Base64.encodeToString(json.toString().toByteArray(StandardCharsets.UTF_8), Base64.URL_SAFE or Base64.NO_WRAP)
  }

  companion object {
    fun initial(metricTypes: List<String>) = HealthConnectCursor(phase = "initial", metricTypes = metricTypes, index = 0)

    fun decode(raw: String?): HealthConnectCursor? {
      return try {
        if (raw.isNullOrBlank()) return null
        val json = JSONObject(String(Base64.decode(raw, Base64.URL_SAFE or Base64.NO_WRAP), StandardCharsets.UTF_8))
        if (json.optInt("version") != 1) return null
        val metrics = json.getJSONArray("metricTypes").let { array -> List(array.length()) { array.getString(it) } }
        if (metrics.isEmpty()) return null
        val tokenObject = json.optJSONObject("changeTokens") ?: JSONObject()
        val tokens = tokenObject.keys().asSequence().associateWith { key -> tokenObject.getString(key) }
        HealthConnectCursor(
          phase = json.getString("phase"),
          metricTypes = metrics,
          index = json.optInt("index", 0),
          initialPageToken = json.optString("initialPageToken").takeIf { it.isNotBlank() },
          changeTokens = tokens,
        )
      } catch (_: Exception) {
        null
      }
    }
  }
}

private data class HealthConnectPermissionInput(val permissions: List<String>) : Serializable

/** Adapts Health Connect's AndroidX contract to Expo's serializable input contract. */
private class HealthConnectPermissionContract : AppContextActivityResultContract<HealthConnectPermissionInput, Set<String>> {
  private val delegate = PermissionController.createRequestPermissionResultContract()

  override fun createIntent(context: Context, input: HealthConnectPermissionInput) =
    delegate.createIntent(context, input.permissions.toSet())

  override fun parseResult(input: HealthConnectPermissionInput, resultCode: Int, intent: android.content.Intent?): Set<String> =
    delegate.parseResult(resultCode, intent)
}

private class HealthConnectUnavailableException : CodedException(
  code = "ERR_MAXPOWER_HEALTH_CONNECT_UNAVAILABLE",
  message = "Health Connect is not available",
  cause = null,
)

private class HealthConnectPermissionMissingException : CodedException(
  code = "ERR_MAXPOWER_HEALTH_CONNECT_PERMISSION_MISSING",
  message = "Health Connect permission is missing",
  cause = null,
)
