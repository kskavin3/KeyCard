// Illustrative, all-in ADA prices. This preview never calls an API or wallet.
const services = {
  search: [
    { name: 'Search Alpha', price: 0.08, available: true },
    { name: 'Search Beta', price: 0.02, available: true },
    { name: 'Search Gamma', price: 0.05, available: true },
  ],
  weather: [
    { name: 'Weather Atlas', price: 0.03, available: true },
    { name: 'Weather Now', price: 0.01, available: true },
    { name: 'Weather Cloud', price: 0.005, available: false },
  ],
  image: [
    { name: 'Image Studio', price: 0.4, available: true },
    { name: 'Image Forge', price: 0.25, available: true },
    { name: 'Image Canvas', price: 0.6, available: true },
  ],
};

export function createPreview(capability, mode) {
  if (!Object.hasOwn(services, capability) || !['paid', 'sponsored'].includes(mode)) {
    throw new Error('Choose a valid capability and payment path.');
  }
  const matches = services[capability].filter(service => service.available).sort((a, b) => a.price - b.price);
  const provider = matches[0];
  const sponsored = mode === 'sponsored';
  const steps = [
    `Discovered ${matches.length} available services. Selected ${provider.name}.`,
    `402 Payment Required · example total ₳ ${provider.price.toFixed(2)}`,
    ...(sponsored
      ? ['Matched an example sponsor. Full call cost reserved.', 'adVault entry stored. Hash and receipt verified.']
      : ['Example ADA payment verified against the request.']),
    '200 OK · API response delivered. Provider key stays private.',
  ];
  return {
    provider,
    matchCount: matches.length,
    agentCost: sponsored ? 0 : provider.price,
    steps,
    response: {
      demo: true,
      status: 200,
      capability,
      provider: provider.name,
      paid_by: sponsored ? 'example_sponsor' : 'agent_wallet',
      agent_cost_ada: sponsored ? 0 : provider.price,
      ...(sponsored ? { adVault: 'example_entry_verified' } : {}),
      result: 'Your requested resource is ready.',
    },
  };
}
