import ExpoModulesCore
import HealthKit

/**
 * iOS-only HealthKit bridge. It owns HK types, authorization requests and
 * opaque per-type anchors; it never owns the CoachLedger, Timeline projection
 * or any recovery decision. The TypeScript adapter turns its primitive output
 * into the shared HealthDataPort contract.
 *
 * HealthKit intentionally hides per-type read grants. `requested` below means
 * only that MaxPower completed a request for that type. A later empty query is
 * deliberately indistinguishable from no readable sample.
 */
public final class MaxPowerHealthKitModule: Module {
  private let healthStore = HKHealthStore()
  private let defaults = UserDefaults.standard
  private let dateFormatter = ISO8601DateFormatter()
  private let pageSize = 100
  private let permissionPrefix = "maxpower.healthkit.requested.v1."

  public func definition() -> ModuleDefinition {
    Name("MaxPowerHealthKit")

    AsyncFunction("getAvailabilityAsync") { () -> String in
      HKHealthStore.isHealthDataAvailable() ? "available" : "not_supported"
    }

    AsyncFunction("getPermissionStateAsync") { (metricTypes: [String]) -> [String: String] in
      self.permissionState(metricTypes)
    }

    AsyncFunction("requestPermissionsAsync") { (metricTypes: [String]) async throws -> [String: String] in
      guard HKHealthStore.isHealthDataAvailable() else { return self.unsupportedPermissionState(metricTypes) }
      let readTypes = Set(metricTypes.compactMap { self.objectType(for: $0) })
      guard !readTypes.isEmpty else { return self.unsupportedPermissionState(metricTypes) }
      try await self.healthStore.requestAuthorization(toShare: Set<HKSampleType>(), read: readTypes)
      for metric in metricTypes where self.objectType(for: metric) != nil {
        self.defaults.set(true, forKey: self.permissionPrefix + metric)
      }
      return self.permissionState(metricTypes)
    }

    AsyncFunction("readEvidencePageAsync") { (metricTypes: [String], cursor: String?) async throws -> [String: Any] in
      guard HKHealthStore.isHealthDataAvailable() else { throw HealthKitUnavailableException() }
      let metrics = metricTypes.filter { self.objectType(for: $0) != nil }.sorted()
      guard !metrics.isEmpty else { return ["evidence": []] }
      let decoded = HealthKitCursor.decode(cursor)
      let reset = decoded != nil && decoded?.metricTypes != metrics
      var state = decoded?.metricTypes == metrics
        ? decoded!
        : HealthKitCursor.initial(metrics: metrics, startedAt: self.dateFormatter.string(from: Date().addingTimeInterval(-30 * 24 * 60 * 60)))
      let metric = state.currentMetric
      let page = try await self.readPage(metric: metric, state: state)
      state.anchors[metric] = page.anchor
      if page.exhausted {
        state.completedInitial.insert(metric)
        state.index = (state.index + 1) % state.metricTypes.count
      }
      let initialPending = state.completedInitial.count < state.metricTypes.count
      let hasMore = !page.exhausted || initialPending
      var result: [String: Any] = [
        "evidence": page.evidence,
        "nextCursor": state.encode(),
      ]
      if reset { result["cursorReset"] = true }
      if hasMore { result["hasMore"] = true }
      if initialPending { result["initialSyncPending"] = true }
      return result
    }
  }

  private func permissionState(_ metricTypes: [String]) -> [String: String] {
    var result: [String: String] = [:]
    for metric in metricTypes {
      result[metric] = objectType(for: metric) == nil
        ? "not_supported"
        : defaults.bool(forKey: permissionPrefix + metric) ? "requested" : "not_requested"
    }
    return result
  }

  private func unsupportedPermissionState(_ metricTypes: [String]) -> [String: String] {
    Dictionary(uniqueKeysWithValues: metricTypes.map { ($0, "not_supported") })
  }

  private func objectType(for metric: String) -> HKSampleType? {
    switch metric {
    case "sleep": return HKObjectType.categoryType(forIdentifier: .sleepAnalysis)
    case "hrv_sdnn": return HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)
    case "resting_heart_rate": return HKObjectType.quantityType(forIdentifier: .restingHeartRate)
    case "activity": return HKObjectType.workoutType()
    case "body_weight": return HKObjectType.quantityType(forIdentifier: .bodyMass)
    case "body_fat_percentage": return HKObjectType.quantityType(forIdentifier: .bodyFatPercentage)
    default: return nil
    }
  }

  private func readPage(metric: String, state: HealthKitCursor) async throws -> HealthKitPage {
    guard let type = objectType(for: metric) else { throw HealthKitMetricUnsupportedException() }
    let anchor = state.anchors[metric].flatMap(HealthKitCursor.decodeAnchor)
    let predicate: NSPredicate?
    if anchor == nil, let date = dateFormatter.date(from: state.initialStartedAt) {
      predicate = HKQuery.predicateForSamples(withStart: date, end: Date(), options: .strictStartDate)
    } else {
      predicate = nil
    }
    return try await withCheckedThrowingContinuation { continuation in
      let query = HKAnchoredObjectQuery(type: type, predicate: predicate, anchor: anchor, limit: pageSize) {
        [weak self] _, added, deleted, nextAnchor, error in
        guard let self else { return }
        if let error {
          continuation.resume(throwing: error)
          return
        }
        guard let nextAnchor else {
          continuation.resume(throwing: HealthKitAnchorMissingException())
          return
        }
        let observedAt = self.dateFormatter.string(from: Date())
        let evidence = (added ?? []).compactMap { self.evidence(for: $0, metric: metric, observedAt: observedAt) }
          + (deleted ?? []).map { object in
            ["id": object.uuid.uuidString, "metric": metric, "observedAt": observedAt, "change": "delete"] as [String: Any]
          }
        let count = (added?.count ?? 0) + (deleted?.count ?? 0)
        continuation.resume(returning: HealthKitPage(
          evidence: evidence,
          anchor: HealthKitCursor.encodeAnchor(nextAnchor),
          exhausted: count < self.pageSize
        ))
      }
      self.healthStore.execute(query)
    }
  }

  private func evidence(for sample: HKSample, metric: String, observedAt: String) -> [String: Any]? {
    var result = commonEvidence(sample, metric: metric, observedAt: observedAt)
    switch metric {
    case "sleep":
      guard let category = sample as? HKCategorySample else { return nil }
      guard let stage = asleepStageName(category.value) else { return nil }
      result["value"] = sample.endDate.timeIntervalSince(sample.startDate) / 60
      result["unit"] = "minutes"
      result["occurredAt"] = dateFormatter.string(from: sample.startDate)
      result["endedAt"] = dateFormatter.string(from: sample.endDate)
      result["measurementMethod"] = "sleep_stage:" + stage
    case "hrv_sdnn":
      guard let quantity = sample as? HKQuantitySample else { return nil }
      result["value"] = quantity.quantity.doubleValue(for: HKUnit.secondUnit(with: .milli))
      result["unit"] = "milliseconds"
      result["occurredAt"] = dateFormatter.string(from: sample.startDate)
    case "resting_heart_rate":
      guard let quantity = sample as? HKQuantitySample else { return nil }
      result["value"] = quantity.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
      result["unit"] = "beats_per_minute"
      result["occurredAt"] = dateFormatter.string(from: sample.startDate)
    case "activity":
      guard let workout = sample as? HKWorkout else { return nil }
      result["value"] = workout.duration / 60
      result["unit"] = "minutes"
      result["occurredAt"] = dateFormatter.string(from: workout.startDate)
      result["endedAt"] = dateFormatter.string(from: workout.endDate)
      result["measurementMethod"] = "workout:" + String(workout.workoutActivityType.rawValue)
    case "body_weight":
      guard let quantity = sample as? HKQuantitySample else { return nil }
      result["value"] = quantity.quantity.doubleValue(for: HKUnit.gramUnit(with: .kilo))
      result["unit"] = "kg"
      result["occurredAt"] = dateFormatter.string(from: sample.startDate)
    case "body_fat_percentage":
      guard let quantity = sample as? HKQuantitySample else { return nil }
      // HealthKit's percent unit is fractional (0.20 represents 20%). The
      // shared Timeline contract stores display percent points (20).
      result["value"] = quantity.quantity.doubleValue(for: HKUnit.percent()) * 100
      result["unit"] = "percent"
      result["occurredAt"] = dateFormatter.string(from: sample.startDate)
    default: return nil
    }
    return result
  }

  private func commonEvidence(_ sample: HKSample, metric: String, observedAt: String) -> [String: Any] {
    var result: [String: Any] = [
      "id": sample.uuid.uuidString,
      "metric": metric,
      "observedAt": observedAt,
      "sourceBundleId": sample.sourceRevision.source.bundleIdentifier,
    ]
    if let version = sample.sourceRevision.version { result["sourceVersion"] = version }
    if let device = sample.device {
      if let id = device.udiDeviceIdentifier { result["deviceId"] = id }
      if let manufacturer = device.manufacturer { result["deviceManufacturer"] = manufacturer }
      if let model = device.model { result["deviceModel"] = model }
      if let localIdentifier = device.localIdentifier { result["deviceType"] = localIdentifier }
    }
    if let timeZone = sample.metadata?[HKMetadataKeyTimeZone] as? TimeZone {
      result["timezoneOffsetMinutes"] = timeZone.secondsFromGMT(for: sample.startDate) / 60
    }
    return result
  }

  private func asleepStageName(_ value: Int) -> String? {
    if value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue { return "asleep_unspecified" }
    if #available(iOS 16.0, *) {
      if value == HKCategoryValueSleepAnalysis.asleepCore.rawValue { return "asleep_core" }
      if value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue { return "asleep_deep" }
      if value == HKCategoryValueSleepAnalysis.asleepREM.rawValue { return "asleep_rem" }
    }
    return nil
  }
}

private struct HealthKitPage {
  let evidence: [[String: Any]]
  let anchor: String
  let exhausted: Bool
}

private struct HealthKitCursor: Codable {
  var version: Int = 1
  var metricTypes: [String]
  var index: Int = 0
  var initialStartedAt: String
  var anchors: [String: String] = [:]
  var completedInitial: Set<String> = []

  var currentMetric: String { metricTypes[min(max(index, 0), metricTypes.count - 1)] }

  static func initial(metrics: [String], startedAt: String) -> HealthKitCursor {
    HealthKitCursor(metricTypes: metrics, initialStartedAt: startedAt)
  }

  func encode() -> String {
    guard let data = try? JSONEncoder().encode(self) else { return "" }
    return data.base64EncodedString()
  }

  static func decode(_ value: String?) -> HealthKitCursor? {
    guard let value, let data = Data(base64Encoded: value), let cursor = try? JSONDecoder().decode(HealthKitCursor.self, from: data), cursor.version == 1, !cursor.metricTypes.isEmpty else { return nil }
    return cursor
  }

  static func encodeAnchor(_ anchor: HKQueryAnchor) -> String {
    (try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true))?.base64EncodedString() ?? ""
  }

  static func decodeAnchor(_ value: String) -> HKQueryAnchor? {
    guard let data = Data(base64Encoded: value) else { return nil }
    return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
  }
}

private final class HealthKitUnavailableException: Exception, @unchecked Sendable { override var reason: String { "healthkit_unavailable" } }
private final class HealthKitMetricUnsupportedException: Exception, @unchecked Sendable { override var reason: String { "healthkit_metric_unsupported" } }
private final class HealthKitAnchorMissingException: Exception, @unchecked Sendable { override var reason: String { "healthkit_anchor_missing" } }
