const { withEntitlementsPlist, withInfoPlist } = require("@expo/config-plugins");

/** Adds the HealthKit entitlement and only the read-purpose string. */
module.exports = function withMaxPowerHealthKit(config) {
  config = withEntitlementsPlist(config, (next) => {
    next.modResults["com.apple.developer.healthkit"] = true;
    return next;
  });
  return withInfoPlist(config, (next) => {
    next.modResults.NSHealthShareUsageDescription = "MaxPower 仅读取你选择的健康记录，用于在本地呈现训练、恢复和趋势；你可以随时停止连接。";
    return next;
  });
};
