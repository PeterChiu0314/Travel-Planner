export const transportRoles = {
  normalPair: "normal_pair",
  tailPending: "tail_pending",
  tailPromotedPair: "tail_promoted_pair",
};

const validRoles = new Set(Object.values(transportRoles));

export function isTransportationCard(item) {
  return item?.item_type === "transport";
}

export function normalizeTransportRole(item) {
  if (!isTransportationCard(item)) return null;
  if (validRoles.has(item.transport_role)) return item.transport_role;
  return item.to_item_id ? transportRoles.normalPair : transportRoles.tailPending;
}

export function isNormalTransportPair(item) {
  return normalizeTransportRole(item) === transportRoles.normalPair;
}

export function isTailPendingTransport(item) {
  return normalizeTransportRole(item) === transportRoles.tailPending;
}

export function isTailPromotedTransportPair(item) {
  return normalizeTransportRole(item) === transportRoles.tailPromotedPair;
}

export function isEstablishedTransportPair(item) {
  return isNormalTransportPair(item) || isTailPromotedTransportPair(item);
}

export function transportRoleForPayload(payload) {
  if (!isTransportationCard(payload)) return null;
  if (validRoles.has(payload.transport_role)) return payload.transport_role;
  return payload.to_item_id ? transportRoles.normalPair : transportRoles.tailPending;
}
