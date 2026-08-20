export const tripPreviewLongSegmentKm = 2000;

const transitNodePattern = /(?:\bairport\b|\bairport terminal\b|\brailway station\b|\btrain station\b|\bbus station\b|\bterminal\b|機場|航空站|航廈|空港|車站|火車站|高鐵站|客運站|轉運站|駅|ターミナル)/iu;

function finiteCoordinate(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function isTripPreviewTransitNode(visit) {
  const category = String(visit?.category || "").toLowerCase();
  if (category === "transport" || category === "note") return true;
  const label = [visit?.title, visit?.location?.name].filter(Boolean).join(" ");
  return transitNodePattern.test(label);
}

export function isTripPreviewEligibleVisit(visit) {
  return Boolean(
    visit
      && !isTripPreviewTransitNode(visit)
      && finiteCoordinate(visit?.location?.latitude, -90, 90)
      && finiteCoordinate(visit?.location?.longitude, -180, 180),
  );
}

export function selectTripPreviewRepresentativeVisit(day) {
  const eligible = (Array.isArray(day?.visits) ? day.visits : []).filter(isTripPreviewEligibleVisit);
  if (!eligible.length) return null;
  return eligible[Math.floor((eligible.length - 1) / 2)];
}

export function tripPreviewDistanceKm(from, to) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const latitudeA = toRadians(from.latitude);
  const latitudeB = toRadians(to.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function dayHasFlight(day) {
  return (Array.isArray(day?.transports) ? day.transports : []).some((transport) => {
    const category = String(transport?.category || "").toLowerCase();
    const name = String(transport?.name || "");
    return category === "flight" || category === "plane" || /(?:flight|airline|飛機|航班)/iu.test(name);
  });
}

export function buildTripPreviewRoute(days, { longSegmentKm = tripPreviewLongSegmentKm } = {}) {
  const sourceDays = Array.isArray(days) ? days : [];
  const points = sourceDays.flatMap((day, sourceIndex) => {
    const visit = selectTripPreviewRepresentativeVisit(day);
    if (!visit) return [];
    return [{
      dayIndex: Number.isInteger(day?.day_index) ? day.day_index : sourceIndex,
      dayLabel: `D${(Number.isInteger(day?.day_index) ? day.day_index : sourceIndex) + 1}`,
      latitude: visit.location.latitude,
      longitude: visit.location.longitude,
      name: visit.title || visit.location.name || `Day ${sourceIndex + 1}`,
      visit,
      sourceIndex,
    }];
  });
  const segments = points.slice(1).map((point, index) => {
    const from = points[index];
    const distanceKm = tripPreviewDistanceKm(from, point);
    const hasFlight = sourceDays.slice(from.sourceIndex + 1, point.sourceIndex + 1).some(dayHasFlight);
    return {
      distanceKm,
      from,
      to: point,
      type: distanceKm > longSegmentKm ? "broken" : hasFlight ? "flight" : "normal",
    };
  });
  return { points, segments };
}
