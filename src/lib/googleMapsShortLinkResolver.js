import { supabase } from "./supabase.js";

export const GOOGLE_MAPS_SHORT_LINK_FUNCTION = "resolve-google-maps-url";

export async function resolveGoogleMapsShortUrl(mapUrl) {
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase.functions.invoke(GOOGLE_MAPS_SHORT_LINK_FUNCTION, {
    body: { mapUrl },
  });

  if (error) throw error;
  if (!data?.expandedUrl || typeof data.expandedUrl !== "string") {
    throw new Error("Missing expanded Google Maps URL");
  }

  return data.expandedUrl;
}
