import StaticMapProvider from "./StaticMapProvider.jsx";

export function getGoogleMapProviderStatus() {
  return {
    providerId: "google",
    loadMode: "lazy",
    sdkLoaded: false,
    sdkPackageBundled: false,
    ready: false,
  };
}

export default function GoogleMapProvider(props) {
  return <StaticMapProvider {...props} />;
}
