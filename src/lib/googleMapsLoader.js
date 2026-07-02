import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { shouldLogMapProviderDiagnostics } from "./mapProviderDiagnostics.js";

let configuredApiKey = null;

function redactSensitiveLoaderText(value) {
  if (typeof value !== "string") return undefined;
  return value.replace(/([?&](?:key|apiKey)=)[^&\s)]+/gi, "$1[redacted]");
}

export function getGoogleMapsLoaderErrorMetadata(error) {
  return {
    name: typeof error?.name === "string" ? error.name : "Error",
    message: redactSensitiveLoaderText(error?.message) || "Unknown Google Maps loader error",
    code: error?.code ?? null,
    stackFirstLine: redactSensitiveLoaderText(typeof error?.stack === "string" ? error.stack.split("\n")[0] : ""),
  };
}

function shouldLogLoaderDiagnostics() {
  const search = typeof window === "undefined" ? "" : window.location.search;
  return shouldLogMapProviderDiagnostics(search);
}

export async function loadGoogleMapsApi({ apiKey } = {}) {
  const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!normalizedApiKey) {
    throw new Error("Missing Google Maps API key");
  }

  try {
    if (configuredApiKey !== normalizedApiKey) {
      setOptions({
        key: normalizedApiKey,
        v: "weekly",
      });
      configuredApiKey = normalizedApiKey;
    }

    return await importLibrary("maps");
  } catch (error) {
    if (shouldLogLoaderDiagnostics()) {
      console.info("[GoogleMapsLoader] diagnostics", getGoogleMapsLoaderErrorMetadata(error));
    }
    throw error;
  }
}
