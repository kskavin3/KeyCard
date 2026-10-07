const LOVELACE_PER_ADA = 1_000_000n;

export function adaToLovelace(value: string): string {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(value.trim());
  if (!match) throw new Error('Enter an ADA amount with at most six decimal places.');
  const amount = BigInt(match[1]) * LOVELACE_PER_ADA + BigInt((match[2] ?? '').padEnd(6, '0') || '0');
  if (amount <= 0n || amount.toString().length > 24) throw new Error('Enter a positive ADA amount within the supported range.');
  return amount.toString();
}

export function formatLovelace(value: string): string {
  if (!/^[0-9]+$/.test(value)) throw new Error('Lovelace must be a non-negative integer string.');
  const amount = BigInt(value);
  const fractional = (amount % LOVELACE_PER_ADA).toString().padStart(6, '0').replace(/0+$/, '');
  return `${amount / LOVELACE_PER_ADA}${fractional ? `.${fractional}` : ''}`;
}

export function applyMarkupLovelace(costLovelace: string, markupBasisPoints: number): string {
  if (!/^[1-9][0-9]{0,23}$/.test(costLovelace) || !Number.isInteger(markupBasisPoints) ||
      markupBasisPoints < 0 || markupBasisPoints > 1_000_000) throw new Error('Invalid ADA price or markup.');
  const numerator = BigInt(costLovelace) * BigInt(10_000 + markupBasisPoints);
  return ((numerator + 9_999n) / 10_000n).toString();
}

export function effectivePriceLovelace(costLovelace: string, markupBasisPoints: number, minimumLovelace: bigint): string {
  if (minimumLovelace <= 0n) throw new Error('Minimum payment must be positive.');
  const markedUp = BigInt(applyMarkupLovelace(costLovelace, markupBasisPoints));
  return (markedUp > minimumLovelace ? markedUp : minimumLovelace).toString();
}
