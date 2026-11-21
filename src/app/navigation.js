import {
  Bed,
  ClipboardCheck,
  HandCoins,
  LayoutDashboard,
  Luggage,
  Map as MapIcon,
  Wallet,
} from "lucide-react";

export const desktopNavItems = [
  { id: "today", label: "旅程總覽", shortLabel: "覽" },
  { id: "timeline", label: "行程路線", shortLabel: "程" },
  { id: "budget", label: "預算管理", shortLabel: "錢" },
  { id: "accommodation", label: "住宿資訊", shortLabel: "宿" },
  { id: "todo", label: "待辦指南", shortLabel: "辦" },
  { id: "luggage", label: "行李清單", shortLabel: "李" },
  { id: "settlement", label: "分帳結算", shortLabel: "結" },
];

export const desktopNavIcons = {
  accommodation: Bed,
  budget: Wallet,
  luggage: Luggage,
  settlement: HandCoins,
  timeline: MapIcon,
  today: LayoutDashboard,
  todo: ClipboardCheck,
};

export const mobileNavItems = [
  { id: "today", label: "今日" },
  { id: "timeline", label: "行程" },
  { id: "budget", label: "預算" },
  { id: "luggage", label: "行李" },
  { id: "settings", label: "更多" },
];
