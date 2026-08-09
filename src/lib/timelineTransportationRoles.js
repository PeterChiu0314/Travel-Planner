export const transportRoles = {
  normalPair: "normal_pair",
};

const validRoles = new Set(Object.values(transportRoles));

export function isTransportationCard(item) {
  return item?.item_type === "transport";
}

export function normalizeTransportRole(item) {
  if (!isTransportationCard(item)) return null;
  return validRoles.has(item.transport_role) && item.from_item_id && item.to_item_id
    ? transportRoles.normalPair
    : null;
}

export function isNormalTransportPair(item) {
  return normalizeTransportRole(item) === transportRoles.normalPair;
}

export function isEstablishedTransportPair(item) {
  return isNormalTransportPair(item);
}

export function transportRoleForPayload(payload) {
  if (!isTransportationCard(payload)) return null;
  return payload.from_item_id && payload.to_item_id ? transportRoles.normalPair : null;
}
