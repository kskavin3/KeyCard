const openObject = { type: 'object', additionalProperties: true };

export const providerTemplates = Object.freeze({
  openai: {
    id: 'openai',
    name: 'OpenAI',
    summary: 'Responses, text generation, and reasoning',
    description: 'Access OpenAI models through the Responses API.',
    capabilities: ['ai', 'text-generation', 'reasoning', 'openai'],
    baseUrl: 'https://api.openai.com',
    credential: { mode: 'header', field: 'Authorization', prefix: 'Bearer ' },
    staticHeaders: {},
    operations: [{
      id: 'create-response', name: 'Create response', description: 'Generate a model response from text or structured input.',
      method: 'POST', path: '/v1/responses', priceAda: '1.5', markupBasisPoints: 200, enabled: true,
      inputSchema: { type: 'object', required: ['model', 'input'], properties: { model: { type: 'string' }, input: {} }, additionalProperties: true },
      outputSchema: openObject,
    }],
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    summary: 'Anthropic Messages API',
    description: 'Access Claude models through the Anthropic Messages API.',
    capabilities: ['ai', 'text-generation', 'reasoning', 'claude'],
    baseUrl: 'https://api.anthropic.com',
    credential: { mode: 'header', field: 'x-api-key', prefix: '' },
    staticHeaders: { 'anthropic-version': '2023-06-01' },
    operations: [{
      id: 'create-message', name: 'Create message', description: 'Generate a Claude message from a conversation.',
      method: 'POST', path: '/v1/messages', priceAda: '1.5', markupBasisPoints: 200, enabled: true,
      inputSchema: { type: 'object', required: ['model', 'max_tokens', 'messages'], properties: { model: { type: 'string' }, max_tokens: { type: 'integer', minimum: 1 }, messages: { type: 'array', minItems: 1 } }, additionalProperties: true },
      outputSchema: openObject,
    }],
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    summary: 'Google AI OpenAI-compatible API',
    description: 'Access Gemini models through Google AI’s OpenAI-compatible chat completions API.',
    capabilities: ['ai', 'text-generation', 'multimodal', 'gemini'],
    baseUrl: 'https://generativelanguage.googleapis.com',
    credential: { mode: 'header', field: 'Authorization', prefix: 'Bearer ' },
    staticHeaders: {},
    operations: [{
      id: 'chat-completion', name: 'Create chat completion', description: 'Generate a Gemini chat completion using an OpenAI-compatible request.',
      method: 'POST', path: '/v1beta/openai/chat/completions', priceAda: '1.5', markupBasisPoints: 200, enabled: true,
      inputSchema: { type: 'object', required: ['model', 'messages'], properties: { model: { type: 'string' }, messages: { type: 'array', minItems: 1 } }, additionalProperties: true },
      outputSchema: openObject,
    }],
  },
  elevenlabs: {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    summary: 'Text-to-speech with timestamps',
    description: 'Generate base64-encoded speech and character-level timing with ElevenLabs.',
    capabilities: ['audio', 'text-to-speech', 'speech-generation', 'elevenlabs'],
    baseUrl: 'https://api.elevenlabs.io',
    credential: { mode: 'header', field: 'xi-api-key', prefix: '' },
    staticHeaders: {},
    operations: [{
      id: 'text-to-speech', name: 'Create speech with timing', description: 'Convert text to base64-encoded speech with character-level timestamps.',
      method: 'POST', path: '/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/with-timestamps', priceAda: '1.5', markupBasisPoints: 200, enabled: true,
      inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1 }, model_id: { type: 'string' } }, additionalProperties: true },
      outputSchema: { type: 'object', required: ['audio_base64'], properties: { audio_base64: { type: 'string' }, alignment: openObject, normalized_alignment: openObject }, additionalProperties: true },
    }],
  },
});

export function cloneProviderTemplate(id) {
  const template = providerTemplates[id];
  return template ? structuredClone(template) : null;
}
