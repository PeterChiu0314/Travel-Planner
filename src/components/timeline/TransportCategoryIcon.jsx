import { transportCategoryMeta } from "../../lib/timelineTransportCategories.js";

export default function TransportCategoryIcon({ category }) {
  const Icon = transportCategoryMeta(category).icon;
  return <Icon aria-hidden="true" />;
}
