import {
  BusFront,
  CarFront,
  CarTaxiFront,
  CircleEllipsis,
  Footprints,
  Plane,
  Ship,
  TrainFront,
  TramFront,
} from "lucide-react";
import { formatTransportDurationMinutes } from "./timelineTime.js";

export const transportCategories = [
  { value: "jr", label: "JR", icon: TrainFront },
  { value: "train", label: "電車", icon: TramFront },
  { value: "bus", label: "公車", icon: BusFront },
  { value: "walk", label: "步行", icon: Footprints },
  { value: "drive", label: "自駕", icon: CarFront },
  { value: "taxi", label: "計程車", icon: CarTaxiFront },
  { value: "ferry", label: "渡輪", icon: Ship },
  { value: "flight", label: "飛機", icon: Plane },
  { value: "other", label: "其他", icon: CircleEllipsis },
];

export function transportCategoryMeta(category) {
  return transportCategories.find((item) => item.value === category) || transportCategories[transportCategories.length - 1];
}

export function transportNameValue(item) {
  const explicitName = String(item?.transport_name || "").trim();
  if (explicitName) return explicitName;
  const legacyTitle = String(item?.title || "").trim();
  const categoryLabel = transportCategoryMeta(item?.transport_category).label;
  return legacyTitle && legacyTitle !== categoryLabel ? legacyTitle : "";
}

export function transportCardTitle(item) {
  const name = transportNameValue(item) || transportCategoryMeta(item?.transport_category).label;
  const duration = formatTransportDurationMinutes(item?.transport_duration_minutes);
  return duration ? `${name}・${duration}` : name;
}
