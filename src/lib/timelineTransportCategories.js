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
