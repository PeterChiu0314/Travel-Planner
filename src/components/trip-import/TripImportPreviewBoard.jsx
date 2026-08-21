import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { loadGoogleMapsApi } from "../../lib/googleMapsLoader.js";
import { buildTripPreviewRoute } from "../../lib/tripImportPreview.js";
import { fetchWikimediaTripImage } from "../../lib/wikimediaTripImages.js";

function createPointOverlay(mapsNamespace, map, point) {
  class PointOverlay extends mapsNamespace.OverlayView {
    onAdd() {
      this.element = document.createElement("div");
      this.element.className = "trip-import-google-point";
      const badge = document.createElement("span");
      badge.textContent = point.dayLabel;
      const label = document.createElement("strong");
      label.textContent = point.name;
      this.element.append(badge, label);
      this.getPanes().overlayMouseTarget.appendChild(this.element);
    }

    draw() {
      const position = this.getProjection().fromLatLngToDivPixel(
        new mapsNamespace.LatLng(point.latitude, point.longitude),
      );
      if (!position || !this.element) return;
      this.element.style.left = `${position.x}px`;
      this.element.style.top = `${position.y}px`;
    }

    onRemove() {
      this.element?.remove();
      this.element = null;
    }
  }

  const overlay = new PointOverlay();
  overlay.setMap(map);
  return overlay;
}

function GoogleTripPreviewMap({ route }) {
  const mapElementRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const apiKey = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || "";

  useEffect(() => {
    let disposed = false;
    let map = null;
    let overlays = [];
    let polylines = [];
    let resizeFrame = null;
    let resizeObserver = null;

    if (!apiKey || !route.points.length || !mapElementRef.current) {
      setStatus("failed");
      return undefined;
    }

    setStatus("loading");
    loadGoogleMapsApi({ apiKey })
      .then((mapsLibrary) => {
        if (disposed || !mapElementRef.current) return;
        const mapsNamespace = window.google?.maps;
        const MapConstructor = mapsLibrary?.Map || mapsNamespace?.Map;
        const BoundsConstructor = mapsLibrary?.LatLngBounds || mapsNamespace?.LatLngBounds;
        const PolylineConstructor = mapsNamespace?.Polyline;
        if (!MapConstructor || !BoundsConstructor || !PolylineConstructor || !mapsNamespace?.OverlayView) {
          throw new Error("Google Maps preview constructors unavailable");
        }

        map = new MapConstructor(mapElementRef.current, {
          center: { lat: route.points[0].latitude, lng: route.points[0].longitude },
          clickableIcons: false,
          disableDefaultUI: true,
          gestureHandling: "none",
          keyboardShortcuts: false,
          styles: [
            { featureType: "poi.business", stylers: [{ visibility: "off" }] },
            { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
          ],
          zoom: 11,
        });

        const bounds = new BoundsConstructor();
        route.points.forEach((point) => {
          bounds.extend({ lat: point.latitude, lng: point.longitude });
          overlays.push(createPointOverlay(mapsNamespace, map, point));
        });

        route.segments.filter((segment) => segment.type !== "broken").forEach((segment) => {
          const flight = segment.type === "flight";
          const lineSymbol = flight ? {
            path: "M 0,-1 0,1",
            scale: 3,
            strokeColor: "#8fac9f",
            strokeOpacity: 0.9,
            strokeWeight: 2,
          } : null;
          polylines.push(new PolylineConstructor({
            geodesic: flight,
            icons: flight ? [{ icon: lineSymbol, offset: "0", repeat: "16px" }] : undefined,
            map,
            path: [
              { lat: segment.from.latitude, lng: segment.from.longitude },
              { lat: segment.to.latitude, lng: segment.to.longitude },
            ],
            strokeColor: flight ? "#8fac9f" : "#174e3c",
            strokeOpacity: flight ? 0 : 0.96,
            strokeWeight: flight ? 3 : 4,
            zIndex: 2,
          }));
        });

        const fitRouteToVisibleMap = () => {
          if (!map || disposed) return;
          mapsNamespace.event.trigger(map, "resize");
          if (route.points.length === 1) {
            map.setCenter({ lat: route.points[0].latitude, lng: route.points[0].longitude });
            map.setZoom(13);
            return;
          }
          map.fitBounds(bounds, { bottom: 44, left: 42, right: 42, top: 56 });
          mapsNamespace.event.addListenerOnce(map, "idle", () => {
            if (map?.getZoom() > 12) map.setZoom(12);
          });
        };

        fitRouteToVisibleMap();
        if (typeof ResizeObserver === "function") {
          resizeObserver = new ResizeObserver(() => {
            if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
            resizeFrame = window.requestAnimationFrame(() => {
              resizeFrame = null;
              fitRouteToVisibleMap();
            });
          });
          resizeObserver.observe(mapElementRef.current);
        }
        setStatus("ready");
      })
      .catch(() => {
        if (!disposed) setStatus("failed");
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      overlays.forEach((overlay) => overlay.setMap(null));
      polylines.forEach((polyline) => polyline.setMap(null));
      overlays = [];
      polylines = [];
      map = null;
    };
  }, [apiKey, route]);

  return (
    <div aria-label="每天一個代表景點的 Google 地圖路線預覽" className="trip-import-google-map-wrap">
      <div className="trip-import-google-map" ref={mapElementRef} />
      {status !== "ready" ? (
        <div className="trip-import-google-map-status">
          {status === "failed" ? "Google 地圖無法載入" : "Google 地圖載入中…"}
        </div>
      ) : null}
    </div>
  );
}

export default function TripImportPreviewBoard({ days = [], trip }) {
  const route = useMemo(() => buildTripPreviewRoute(days), [days]);
  const [cover, setCover] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    async function loadCover() {
      for (const point of route.points) {
        try {
          const image = await fetchWikimediaTripImage(point, trip?.destination, { signal: controller.signal });
          if (image) {
            if (!disposed) setCover(image);
            return;
          }
        } catch (error) {
          if (error?.name === "AbortError") return;
        }
      }
    }
    setCover(null);
    loadCover();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [route.points, trip?.destination]);

  const dateText = trip?.start_date && trip?.end_date ? `${trip.start_date}—${trip.end_date}` : "日期未設定";

  return (
    <div className={`trip-import-preview-board${cover ? " has-cover" : ""}`}>
      <GoogleTripPreviewMap route={route} />
      <div
        className="trip-import-cover"
        style={cover ? { "--trip-import-cover-image": `linear-gradient(90deg, rgba(12, 28, 22, .9), rgba(12, 28, 22, .35)), url("${cover.thumbnailUrl}")` } : undefined}
      >
        <div className="trip-import-cover-copy">
          <strong>{trip?.title || "未命名旅程"}</strong>
          <span><MapPin aria-hidden="true" size={14} />{trip?.destination?.display_name || "目的地未設定"}</span>
          <span>{dateText}</span>
        </div>
        {cover ? (
          <a className="trip-import-cover-credit" href={cover.filePageUrl} rel="noreferrer" target="_blank">
            圖片：{cover.author} · {cover.license}
          </a>
        ) : <span className="trip-import-cover-credit">景點圖片載入中／使用旅程預設背景</span>}
      </div>
    </div>
  );
}
