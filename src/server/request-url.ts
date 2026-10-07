type Query = Record<string, unknown>;

function vercelRoutePath(requestPath: string): string | undefined {
  if (!requestPath.startsWith('/api/')) return undefined;
  return requestPath.slice('/api/'.length);
}

function routePathVariants(requestPath: string): string[] {
  const path = vercelRoutePath(requestPath);
  if (!path) return [];
  try {
    const decoded = decodeURIComponent(path);
    return decoded === path ? [path] : [path, decoded];
  } catch {
    return [path];
  }
}

/** Remove the single `path` query parameter injected by Vercel's /api rewrite. */
export function withoutVercelRewriteQuery(query: Query, requestPath: string, isVercel: boolean): Query {
  const result = { ...query };
  if (!isVercel) return result;

  const routePaths = routePathVariants(requestPath);
  if (!routePaths.length || result.path === undefined) return result;

  const values = Array.isArray(result.path) ? result.path : [result.path];
  const injectedIndex = values.findIndex(value => typeof value === 'string' && routePaths.includes(value));
  if (injectedIndex < 0) return result;

  const remaining = values.filter((_value, index) => index !== injectedIndex);
  if (remaining.length === 0) delete result.path;
  else result.path = remaining.length === 1 ? remaining[0] : remaining;
  return result;
}

function decodeQueryPart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** Build the public request URL used in a payment challenge, without Vercel's route parameter. */
export function publicRequestUrl(
  originalUrl: string,
  requestPath: string,
  origin: string,
  isVercel: boolean,
): string {
  const routePaths = routePathVariants(requestPath);
  const queryStart = originalUrl.indexOf('?');
  if (!isVercel || !routePaths.length || queryStart < 0) return new URL(originalUrl, origin).href;

  const rawPath = originalUrl.slice(0, queryStart);
  const rawParams = originalUrl.slice(queryStart + 1).split('&');
  const injectedIndex = rawParams.findIndex(param => {
    const separator = param.indexOf('=');
    const key = separator < 0 ? param : param.slice(0, separator);
    const value = separator < 0 ? '' : param.slice(separator + 1);
    return decodeQueryPart(key) === 'path' && routePaths.includes(decodeQueryPart(value));
  });
  if (injectedIndex < 0) return new URL(originalUrl, origin).href;

  rawParams.splice(injectedIndex, 1);
  const cleanUrl = rawParams.length ? `${rawPath}?${rawParams.join('&')}` : rawPath;
  return new URL(cleanUrl, origin).href;
}
