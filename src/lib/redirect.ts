const BLOCKED_REDIRECT_PREFIXES = ["/login", "/logout", "/auth"];

export function getSafeRedirectPath(value: FormDataEntryValue | string | string[] | null | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;

  if (typeof rawValue !== "string") {
    return "/";
  }

  const trimmed = rawValue.trim();

  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return "/";
  }

  try {
    const url = new URL(trimmed, "https://stacker.local");

    if (url.origin !== "https://stacker.local") {
      return "/";
    }

    const path = `${url.pathname}${url.search}${url.hash}`;

    if (BLOCKED_REDIRECT_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
      return "/";
    }

    return path;
  } catch {
    return "/";
  }
}

export function createLoginHref(nextPath: string | null | undefined) {
  const safePath = getSafeRedirectPath(nextPath);

  if (safePath === "/") {
    return "/login";
  }

  return `/login?next=${encodeURIComponent(safePath)}`;
}
