export function adaToLovelace(value) {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(String(value).trim());
  if (!match) throw new Error('Enter an ADA cost with at most six decimal places.');
  const lovelace = BigInt(match[1]) * 1_000_000n + BigInt((match[2] || '').padEnd(6, '0') || '0');
  if (lovelace <= 0n || lovelace.toString().length > 24) throw new Error('Enter a positive ADA cost within the supported range.');
  return lovelace.toString();
}

export function formatAda(lovelace) {
  if (lovelace === null || lovelace === undefined) return '— ADA (check manually)';
  const amount = BigInt(lovelace);
  return `${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, '0')} ADA`;
}
