const wikipediaApiUrl = "https://zh.wikipedia.org/w/api.php";
const commonsApiUrl = "https://commons.wikimedia.org/w/api.php";

export function buildWikimediaTripImageSearchUrl(point, destination = {}) {
  const search = [point?.name, destination?.city, destination?.country].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "0",
    gsrlimit: "5",
    gsrsearch: search,
    origin: "*",
    piprop: "thumbnail|name",
    pithumbsize: "1400",
    prop: "pageimages",
  });
  return `${wikipediaApiUrl}?${params.toString()}`;
}

export function normalizeWikimediaPageImageResponse(payload) {
  return normalizeWikimediaPageImageCandidates(payload)[0] || null;
}

export function normalizeWikimediaPageImageCandidates(payload) {
  const pages = Object.values(payload?.query?.pages || {});
  return pages
    .filter((entry) => entry?.thumbnail?.source && entry?.pageimage)
    .map((page) => ({
      fileName: page.pageimage,
      pageTitle: page.title || "Wikimedia",
      thumbnailHeight: Number(page.thumbnail.height) || null,
      thumbnailUrl: page.thumbnail.source,
      thumbnailWidth: Number(page.thumbnail.width) || null,
    }));
}

export function buildWikimediaImageInfoUrl(fileName) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|Credit",
    iiprop: "url|size|extmetadata",
    origin: "*",
    prop: "imageinfo",
    titles: `File:${fileName}`,
  });
  return `${commonsApiUrl}?${params.toString()}`;
}

function stripMarkup(value) {
  if (!value) return "";
  const container = typeof document === "undefined" ? null : document.createElement("div");
  if (!container) return String(value).replace(/<[^>]*>/g, "").trim();
  container.innerHTML = value;
  return container.textContent?.trim() || "";
}

export function normalizeWikimediaImageInfoResponse(payload, fallback) {
  const page = Object.values(payload?.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  const metadata = info?.extmetadata || {};
  const width = Number(info?.width) || fallback.thumbnailWidth || null;
  const height = Number(info?.height) || fallback.thumbnailHeight || null;
  return {
    aspectRatio: width && height ? width / height : null,
    author: stripMarkup(metadata.Artist?.value || metadata.Credit?.value) || "Wikimedia contributor",
    filePageUrl: info?.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fallback.fileName)}`,
    license: stripMarkup(metadata.LicenseShortName?.value) || "Wikimedia Commons",
    licenseUrl: metadata.LicenseUrl?.value || "https://commons.wikimedia.org/",
    ...fallback,
    height,
    width,
  };
}

export function selectBestWikimediaTripImage(candidates, {
  maxAspectRatio = 2.4,
  minAspectRatio = 1.6,
  minHeight = 500,
  minWidth = 1000,
  targetAspectRatio = 1.9,
} = {}) {
  const images = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  if (!images.length) return null;
  return [...images].sort((left, right) => {
    const leftRatio = left.aspectRatio || (left.width && left.height ? left.width / left.height : 0);
    const rightRatio = right.aspectRatio || (right.width && right.height ? right.width / right.height : 0);
    const leftPreferred = leftRatio >= minAspectRatio && leftRatio <= maxAspectRatio
      && left.width >= minWidth && left.height >= minHeight;
    const rightPreferred = rightRatio >= minAspectRatio && rightRatio <= maxAspectRatio
      && right.width >= minWidth && right.height >= minHeight;
    if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
    const leftDistance = leftRatio ? Math.abs(leftRatio - targetAspectRatio) : Number.POSITIVE_INFINITY;
    const rightDistance = rightRatio ? Math.abs(rightRatio - targetAspectRatio) : Number.POSITIVE_INFINITY;
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return (right.width || 0) * (right.height || 0) - (left.width || 0) * (left.height || 0);
  })[0];
}

export async function fetchWikimediaTripImage(point, destination, { signal } = {}) {
  const searchResponse = await fetch(buildWikimediaTripImageSearchUrl(point, destination), { signal });
  if (!searchResponse.ok) throw new Error("Wikimedia search failed");
  const candidates = normalizeWikimediaPageImageCandidates(await searchResponse.json());
  if (!candidates.length) return null;
  const images = await Promise.all(candidates.map(async (candidate) => {
    try {
      const infoResponse = await fetch(buildWikimediaImageInfoUrl(candidate.fileName), { signal });
      if (!infoResponse.ok) throw new Error("Wikimedia image info failed");
      return normalizeWikimediaImageInfoResponse(await infoResponse.json(), candidate);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      const width = candidate.thumbnailWidth;
      const height = candidate.thumbnailHeight;
      return {
        ...candidate,
        aspectRatio: width && height ? width / height : null,
        author: "Wikimedia contributor",
        height,
        license: "Wikimedia Commons",
        width,
      };
    }
  }));
  return selectBestWikimediaTripImage(images);
}
