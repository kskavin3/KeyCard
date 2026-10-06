const rateScale = 100_000_000n;

export function usdRateScaled(value: unknown): bigint {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'number' && !Number.isFinite(value))) throw new Error('ADA/USD quote source returned an invalid rate.');
  const decimal = String(value);
  if (!/^[0-9]{1,16}(?:\.[0-9]{1,24})?$/.test(decimal)) throw new Error('ADA/USD quote source returned an invalid rate.');
  const [whole, fractional = ''] = decimal.split('.');
  // Round the USD/ADA rate down, making the service amount round up. Do not
  // multiply floating point prices or round a rate upward and undercharge.
  const scaled = BigInt(whole) * rateScale + BigInt(fractional.slice(0, 8).padEnd(8, '0'));
  if (scaled <= 0n) throw new Error('ADA/USD quote source returned a zero or too-small rate.');
  return scaled;
}

export function toLovelace(priceUsdMicros: string, adaUsdScaled: bigint, minimum: bigint) {
  if (!/^[1-9][0-9]*$/.test(priceUsdMicros) || adaUsdScaled <= 0n || minimum <= 0n) throw new Error('Invalid quote amount or rate.');
  const amount = (BigInt(priceUsdMicros) * rateScale + adaUsdScaled - 1n) / adaUsdScaled;
  return amount > minimum ? amount : minimum;
}

export function createAdaUsdRate({
  apiKey = () => process.env.FREECRYPTOAPI_API_KEY,
  request = fetch,
  now = Date.now,
}: { apiKey?: () => string | undefined; request?: typeof fetch; now?: () => number } = {}) {
  let cache: { value: bigint; expiresAt: number } | undefined;
  let refresh: Promise<bigint> | undefined;
  const fetchRate = async () => {
    const key = apiKey();
    if (!key) throw new Error('FREECRYPTOAPI_API_KEY is required to issue ADA payment quotes.');
    const response = await request('https://api.freecryptoapi.com/v1/getConversion?from=ADA&to=USD&amount=1', {
      headers: { Authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('ADA/USD quote source is temporarily unavailable.');
    const payload = await response.json() as { status?: unknown; result?: unknown };
    // Some API plan/authentication errors use HTTP 200 with status:false.
    if (payload.status !== 'success') throw new Error('ADA/USD quote source refused the conversion request.');
    const value = usdRateScaled(payload.result);
    cache = { value, expiresAt: now() + 60_000 };
    return value;
  };
  return async () => {
    if (cache && cache.expiresAt > now()) return cache.value;
    refresh ??= fetchRate().finally(() => { refresh = undefined; });
    return refresh;
  };
}
