const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const allowedShortHosts = new Set(["maps.app.goo.gl"]);
const allowedRedirectHosts = new Set(["maps.app.goo.gl", "www.google.com", "google.com", "maps.google.com"]);
const maxRedirects = 5;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: corsHeaders,
    status,
  });
}

function parseHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isAllowedShortUrl(url: URL) {
  return allowedShortHosts.has(url.hostname.toLowerCase());
}

function isAllowedFetchUrl(url: URL) {
  return allowedRedirectHosts.has(url.hostname.toLowerCase());
}

async function fetchRedirectLocation(url: URL) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    return await fetch(url.href, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function resolveGoogleMapsShortUrl(startUrl: URL) {
  let currentUrl = startUrl;

  for (let index = 0; index <= maxRedirects; index += 1) {
    if (!isAllowedFetchUrl(currentUrl)) {
      throw new Error("redirect_host_not_allowed");
    }

    const response = await fetchRedirectLocation(currentUrl);
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      currentUrl = new URL(location, currentUrl);
      if (currentUrl.protocol !== "https:") {
        throw new Error("redirect_protocol_not_allowed");
      }
      continue;
    }

    if (isAllowedShortUrl(currentUrl)) {
      throw new Error("short_url_not_expanded");
    }

    return currentUrl.href;
  }

  throw new Error("too_many_redirects");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const url = parseHttpsUrl(body.mapUrl);
  if (!url || !isAllowedShortUrl(url)) {
    return jsonResponse({ error: "unsupported_url" }, 400);
  }

  try {
    const expandedUrl = await resolveGoogleMapsShortUrl(url);
    return jsonResponse({ expandedUrl });
  } catch (error) {
    return jsonResponse(
      {
        error: "resolve_failed",
        reason: error instanceof Error ? error.message : "unknown",
      },
      422,
    );
  }
});
