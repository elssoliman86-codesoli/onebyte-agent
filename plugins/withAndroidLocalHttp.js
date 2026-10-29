/**
 * Allow cleartext HTTP only to explicitly approved local hosts.
 *
 * Android 9+ blocks cleartext HTTP by default. OmniRoute runs on the user's
 * computer, so the Android app needs a narrow exception for its LAN address.
 * Keep all other destinations HTTPS-only.
 *
 * When the computer's LAN IP changes, update allowedHosts in app.json and
 * rebuild the APK; Android network policy is compiled into the native app.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const DEFAULT_ALLOWED_HOSTS = ["192.168.1.10"];

function normalizeAllowedHosts(input) {
  const values = input === undefined ? DEFAULT_ALLOWED_HOSTS : input;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      "withAndroidLocalHttp requires a non-empty allowedHosts array."
    );
  }

  const hosts = values.map((item) => {
    if (typeof item !== "string") {
      throw new Error("withAndroidLocalHttp allowedHosts entries must be strings.");
    }
    const host = item.trim().toLowerCase();
    // Hostnames and IPv4 literals only: no URL, port, path, wildcard, or XML.
    if (
      !host ||
      !/^[a-z0-9.-]+$/.test(host) ||
      host.startsWith(".") ||
      host.endsWith(".") ||
      host.includes("..") ||
      host.includes("://")
    ) {
      throw new Error(
        `Invalid allowedHosts entry "${item}". Use a hostname or IPv4 address without a port.`
      );
    }
    return host;
  });

  return [...new Set(hosts)];
}

function withAndroidLocalHttp(config, options = {}) {
  const allowedHosts = normalizeAllowedHosts(options.allowedHosts);

  config = withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error(
        "OneByte Agent: could not find the Android application manifest entry."
      );
    }

    application.$ = application.$ || {};
    application.$["android:networkSecurityConfig"] =
      "@xml/network_security_config";

    // When Network Security Config is present, avoid a broad app-wide opt-in.
    delete application.$["android:usesCleartextTraffic"];
    return modConfig;
  });

  config = withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const resourceDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml"
      );
      await fs.mkdir(resourceDir, { recursive: true });

      const domainConfigs = allowedHosts
        .map(
          (host) =>
            [
              '  <domain-config cleartextTrafficPermitted="true">',
              '    <domain includeSubdomains="false">' + host + "</domain>",
              "  </domain-config>",
            ].join("\n")
        )
        .join("\n");

      const xml = [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<network-security-config>",
        '  <base-config cleartextTrafficPermitted="false" />',
        domainConfigs,
        "</network-security-config>",
        "",
      ].join("\n");

      await fs.writeFile(
        path.join(resourceDir, "network_security_config.xml"),
        xml,
        "utf8"
      );
      return modConfig;
    },
  ]);

  return config;
}

module.exports = withAndroidLocalHttp;
