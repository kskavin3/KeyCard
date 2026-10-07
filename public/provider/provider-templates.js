const openObject = { type: 'object', additionalProperties: true };

function objectSchema(properties = {}, required = []) {
  const schema = { type: 'object', properties, additionalProperties: true };
  if (required.length) schema.required = required;
  return schema;
}

function pathSchema(...names) {
  return objectSchema(Object.fromEntries(names.map(name => [name, { type: 'string', minLength: 1 }])), names);
}

function operation(id, name, description, method, path, inputSchema = openObject, options = {}) {
  return {
    id, name, description, method, path,
    priceAda: '1.5', markupBasisPoints: 200,
    enabled: options.enabled ?? true,
    inputSchema,
    outputSchema: options.outputSchema ?? openObject,
  };
}

const openAiOperations = [
  operation('create-response', 'Create response', 'Generate a model response from text or structured input.', 'POST', '/v1/responses', objectSchema({ model: { type: 'string' }, input: {} }, ['model', 'input'])),
  operation('retrieve-response', 'Retrieve response', 'Retrieve a previously created response.', 'GET', '/v1/responses/{response_id}', pathSchema('response_id')),
  operation('delete-response', 'Delete response', 'Delete a stored response.', 'DELETE', '/v1/responses/{response_id}', pathSchema('response_id'), { enabled: false }),
  operation('cancel-response', 'Cancel response', 'Cancel an in-progress background response.', 'POST', '/v1/responses/{response_id}/cancel', pathSchema('response_id'), { enabled: false }),
  operation('list-response-input-items', 'List response input items', 'List the input items for a response.', 'GET', '/v1/responses/{response_id}/input_items', pathSchema('response_id')),
  operation('create-chat-completion', 'Create chat completion', 'Generate a chat completion using the compatibility API.', 'POST', '/v1/chat/completions', objectSchema({ model: { type: 'string' }, messages: { type: 'array', minItems: 1 } }, ['model', 'messages'])),
  operation('create-embedding', 'Create embeddings', 'Create vector embeddings for one or more inputs.', 'POST', '/v1/embeddings', objectSchema({ model: { type: 'string' }, input: {} }, ['model', 'input'])),
  operation('create-image', 'Generate image', 'Generate images from a text prompt.', 'POST', '/v1/images/generations', objectSchema({ prompt: { type: 'string', minLength: 1 } }, ['prompt'])),
  operation('create-moderation', 'Create moderation', 'Classify text or image inputs for safety.', 'POST', '/v1/moderations', objectSchema({ input: {} }, ['input'])),
  operation('list-models', 'List models', 'List models available to the API key.', 'GET', '/v1/models'),
  operation('retrieve-model', 'Retrieve model', 'Retrieve metadata for a model.', 'GET', '/v1/models/{model}', pathSchema('model')),
  operation('create-batch', 'Create batch', 'Create an asynchronous batch from an uploaded input file.', 'POST', '/v1/batches', objectSchema({ input_file_id: { type: 'string' }, endpoint: { type: 'string' }, completion_window: { type: 'string' } }, ['input_file_id', 'endpoint', 'completion_window'])),
  operation('list-batches', 'List batches', 'List asynchronous batches.', 'GET', '/v1/batches'),
  operation('retrieve-batch', 'Retrieve batch', 'Retrieve an asynchronous batch.', 'GET', '/v1/batches/{batch_id}', pathSchema('batch_id')),
  operation('cancel-batch', 'Cancel batch', 'Cancel an in-progress batch.', 'POST', '/v1/batches/{batch_id}/cancel', pathSchema('batch_id'), { enabled: false }),
  operation('list-files', 'List files', 'List uploaded files and their metadata.', 'GET', '/v1/files'),
  operation('retrieve-file', 'Retrieve file metadata', 'Retrieve metadata for an uploaded file.', 'GET', '/v1/files/{file_id}', pathSchema('file_id')),
  operation('delete-file', 'Delete file', 'Delete an uploaded file.', 'DELETE', '/v1/files/{file_id}', pathSchema('file_id'), { enabled: false }),
  operation('create-vector-store', 'Create vector store', 'Create a vector store for file search.', 'POST', '/v1/vector_stores', objectSchema({ name: { type: 'string' } })),
  operation('list-vector-stores', 'List vector stores', 'List vector stores available to the API key.', 'GET', '/v1/vector_stores'),
];

const claudeOperations = [
  operation('create-message', 'Create message', 'Generate a Claude message from a conversation.', 'POST', '/v1/messages', objectSchema({ model: { type: 'string' }, max_tokens: { type: 'integer', minimum: 1 }, messages: { type: 'array', minItems: 1 } }, ['model', 'max_tokens', 'messages'])),
  operation('count-message-tokens', 'Count message tokens', 'Count input tokens before creating a message.', 'POST', '/v1/messages/count_tokens', objectSchema({ model: { type: 'string' }, messages: { type: 'array', minItems: 1 } }, ['model', 'messages'])),
  operation('create-message-batch', 'Create message batch', 'Create an asynchronous batch of Messages requests.', 'POST', '/v1/messages/batches', objectSchema({ requests: { type: 'array', minItems: 1 } }, ['requests'])),
  operation('list-message-batches', 'List message batches', 'List Message Batches in the workspace.', 'GET', '/v1/messages/batches'),
  operation('retrieve-message-batch', 'Retrieve message batch', 'Retrieve the current state of a Message Batch.', 'GET', '/v1/messages/batches/{message_batch_id}', pathSchema('message_batch_id')),
  operation('cancel-message-batch', 'Cancel message batch', 'Cancel an in-progress Message Batch.', 'POST', '/v1/messages/batches/{message_batch_id}/cancel', pathSchema('message_batch_id'), { enabled: false }),
  operation('delete-message-batch', 'Delete message batch', 'Delete a Message Batch.', 'DELETE', '/v1/messages/batches/{message_batch_id}', pathSchema('message_batch_id'), { enabled: false }),
  operation('list-models', 'List models', 'List available Claude models.', 'GET', '/v1/models'),
  operation('retrieve-model', 'Retrieve model', 'Get metadata for a Claude model.', 'GET', '/v1/models/{model_id}', pathSchema('model_id')),
  operation('list-files', 'List files', 'List files in the workspace.', 'GET', '/v1/files'),
  operation('retrieve-file', 'Retrieve file metadata', 'Get metadata for a file.', 'GET', '/v1/files/{file_id}', pathSchema('file_id')),
  operation('delete-file', 'Delete file', 'Delete a file from the workspace.', 'DELETE', '/v1/files/{file_id}', pathSchema('file_id'), { enabled: false }),
  operation('list-skills', 'List skills', 'List skills available in the workspace.', 'GET', '/v1/skills'),
  operation('retrieve-skill', 'Retrieve skill', 'Get a skill by ID.', 'GET', '/v1/skills/{skill_id}', pathSchema('skill_id')),
  operation('delete-skill', 'Delete skill', 'Delete a custom skill.', 'DELETE', '/v1/skills/{skill_id}', pathSchema('skill_id'), { enabled: false }),
  operation('list-skill-versions', 'List skill versions', 'List versions of a skill.', 'GET', '/v1/skills/{skill_id}/versions', pathSchema('skill_id')),
  operation('retrieve-skill-version', 'Retrieve skill version', 'Get a specific skill version.', 'GET', '/v1/skills/{skill_id}/versions/{version}', pathSchema('skill_id', 'version')),
  operation('delete-skill-version', 'Delete skill version', 'Delete a specific skill version.', 'DELETE', '/v1/skills/{skill_id}/versions/{version}', pathSchema('skill_id', 'version'), { enabled: false }),
  operation('retrieve-organization', 'Retrieve organization', 'Retrieve the organization associated with the API key.', 'GET', '/v1/organizations/me'),
];

const geminiOperations = [
  operation('create-interaction', 'Create interaction', 'Create an interaction using Gemini’s recommended agentic API.', 'POST', '/v1/interactions', objectSchema({ model: { type: 'string' }, input: {} }, ['model', 'input'])),
  operation('retrieve-interaction', 'Retrieve interaction', 'Retrieve an interaction by ID.', 'GET', '/v1/interactions/{id}', pathSchema('id')),
  operation('cancel-interaction', 'Cancel interaction', 'Cancel an in-progress interaction.', 'POST', '/v1/interactions/{id}/cancel', pathSchema('id'), { enabled: false }),
  operation('delete-interaction', 'Delete interaction', 'Delete an interaction.', 'DELETE', '/v1/interactions/{id}', pathSchema('id'), { enabled: false }),
  operation('generate-content', 'Generate content', 'Generate a complete model response.', 'POST', '/v1beta/models/{model}:generateContent', objectSchema({ model: { type: 'string' }, contents: { type: 'array', minItems: 1 } }, ['model', 'contents'])),
  operation('count-tokens', 'Count tokens', 'Count tokens in content before generation.', 'POST', '/v1beta/models/{model}:countTokens', objectSchema({ model: { type: 'string' } }, ['model'])),
  operation('embed-content', 'Embed content', 'Generate a text embedding vector.', 'POST', '/v1beta/models/{model}:embedContent', objectSchema({ model: { type: 'string' }, content: openObject }, ['model', 'content'])),
  operation('batch-embed-content', 'Batch embed content', 'Generate embeddings for a batch of content.', 'POST', '/v1beta/models/{model}:batchEmbedContents', objectSchema({ model: { type: 'string' }, requests: { type: 'array', minItems: 1 } }, ['model', 'requests'])),
  operation('batch-generate-content', 'Batch generate content', 'Queue a batch of content generation requests.', 'POST', '/v1beta/models/{model}:batchGenerateContent', objectSchema({ model: { type: 'string' } }, ['model'])),
  operation('list-models', 'List models', 'List models available through the Gemini API.', 'GET', '/v1beta/models'),
  operation('retrieve-model', 'Retrieve model', 'Get metadata for a Gemini model.', 'GET', '/v1beta/models/{model}', pathSchema('model')),
  operation('create-cached-content', 'Create cached content', 'Create a reusable cached content resource.', 'POST', '/v1beta/cachedContents'),
  operation('list-cached-content', 'List cached content', 'List cached content resources.', 'GET', '/v1beta/cachedContents'),
  operation('retrieve-cached-content', 'Retrieve cached content', 'Retrieve a cached content resource.', 'GET', '/v1beta/cachedContents/{cached_content_id}', pathSchema('cached_content_id')),
  operation('update-cached-content', 'Update cached content', 'Update the expiration of cached content.', 'PATCH', '/v1beta/cachedContents/{cached_content_id}', pathSchema('cached_content_id'), { enabled: false }),
  operation('delete-cached-content', 'Delete cached content', 'Delete cached content.', 'DELETE', '/v1beta/cachedContents/{cached_content_id}', pathSchema('cached_content_id'), { enabled: false }),
  operation('list-files', 'List files', 'List uploaded Gemini files.', 'GET', '/v1beta/files'),
  operation('retrieve-file', 'Retrieve file', 'Retrieve metadata for a Gemini file.', 'GET', '/v1beta/files/{file_id}', pathSchema('file_id')),
  operation('delete-file', 'Delete file', 'Delete a Gemini file.', 'DELETE', '/v1beta/files/{file_id}', pathSchema('file_id'), { enabled: false }),
  operation('register-file', 'Register Cloud Storage file', 'Register a Google Cloud Storage file with FileService.', 'POST', '/v1beta/files:register', objectSchema({ file: openObject }, ['file'])),
];

const speechWithTimingOutput = {
  type: 'object', required: ['audio_base64'],
  properties: { audio_base64: { type: 'string' }, alignment: openObject, normalized_alignment: openObject },
  additionalProperties: true,
};

const elevenLabsOperations = [
  operation('text-to-speech', 'Create speech with timing', 'Convert text to base64-encoded speech with character-level timestamps.', 'POST', '/v1/text-to-speech/{voice_id}/with-timestamps', objectSchema({ voice_id: { type: 'string' }, text: { type: 'string', minLength: 1 }, model_id: { type: 'string' } }, ['voice_id', 'text']), { outputSchema: speechWithTimingOutput }),
  operation('list-models', 'List models', 'List ElevenLabs models and their capabilities.', 'GET', '/v1/models'),
  operation('list-voices', 'List voices', 'List voices available to the API key.', 'GET', '/v1/voices'),
  operation('retrieve-voice', 'Retrieve voice', 'Retrieve metadata for a voice.', 'GET', '/v1/voices/{voice_id}', pathSchema('voice_id')),
  operation('retrieve-voice-settings', 'Retrieve voice settings', 'Retrieve the settings for a voice.', 'GET', '/v1/voices/{voice_id}/settings', pathSchema('voice_id')),
  operation('list-history', 'List generated items', 'List generated speech history items.', 'GET', '/v1/history'),
  operation('retrieve-history-item', 'Retrieve history item', 'Retrieve metadata for a generated item.', 'GET', '/v1/history/{history_item_id}', pathSchema('history_item_id')),
  operation('delete-history-item', 'Delete history item', 'Delete a generated history item.', 'DELETE', '/v1/history/{history_item_id}', pathSchema('history_item_id'), { enabled: false }),
  operation('list-pronunciation-dictionaries', 'List pronunciation dictionaries', 'List accessible pronunciation dictionaries.', 'GET', '/v1/pronunciation-dictionaries'),
  operation('retrieve-pronunciation-dictionary', 'Retrieve pronunciation dictionary', 'Retrieve a pronunciation dictionary and its rules.', 'GET', '/v1/pronunciation-dictionaries/{pronunciation_dictionary_id}', pathSchema('pronunciation_dictionary_id')),
  operation('retrieve-user', 'Retrieve user', 'Retrieve information about the authenticated user.', 'GET', '/v1/user'),
  operation('retrieve-subscription', 'Retrieve subscription', 'Retrieve subscription and quota information.', 'GET', '/v1/user/subscription'),
];

export const providerTemplates = Object.freeze({
  openai: {
    id: 'openai', name: 'OpenAI', summary: 'Responses, generation, embeddings, and platform resources',
    description: 'Access current JSON-compatible OpenAI APIs through KeyCard.', capabilities: ['ai', 'text-generation', 'reasoning', 'embeddings', 'image-generation', 'openai'],
    baseUrl: 'https://api.openai.com', credential: { mode: 'header', field: 'Authorization', prefix: 'Bearer ' }, staticHeaders: {},
    catalogUpdatedAt: '2026-10-07', docsUrl: 'https://platform.openai.com/docs/api-reference', operations: openAiOperations,
  },
  claude: {
    id: 'claude', name: 'Claude', summary: 'Messages, batches, models, files, and skills',
    description: 'Access current JSON-compatible Claude Platform APIs through KeyCard.', capabilities: ['ai', 'text-generation', 'reasoning', 'batch', 'claude'],
    baseUrl: 'https://api.anthropic.com', credential: { mode: 'header', field: 'x-api-key', prefix: '' }, staticHeaders: { 'anthropic-version': '2023-06-01' },
    catalogUpdatedAt: '2026-10-07', docsUrl: 'https://platform.claude.com/docs/en/api/overview', operations: claudeOperations,
  },
  gemini: {
    id: 'gemini', name: 'Gemini', summary: 'Interactions, content generation, embeddings, and files',
    description: 'Access current JSON-compatible native Gemini APIs through KeyCard.', capabilities: ['ai', 'text-generation', 'multimodal', 'embeddings', 'gemini'],
    baseUrl: 'https://generativelanguage.googleapis.com', credential: { mode: 'header', field: 'x-goog-api-key', prefix: '' }, staticHeaders: {},
    catalogUpdatedAt: '2026-10-07', docsUrl: 'https://ai.google.dev/api', operations: geminiOperations,
  },
  elevenlabs: {
    id: 'elevenlabs', name: 'ElevenLabs', summary: 'Speech generation, voices, models, and history',
    description: 'Access current JSON-compatible ElevenLabs APIs through KeyCard.', capabilities: ['audio', 'text-to-speech', 'speech-generation', 'voices', 'elevenlabs'],
    baseUrl: 'https://api.elevenlabs.io', credential: { mode: 'header', field: 'xi-api-key', prefix: '' }, staticHeaders: {},
    catalogUpdatedAt: '2026-10-07', docsUrl: 'https://elevenlabs.io/docs/api-reference/introduction', operations: elevenLabsOperations,
  },
});

export function cloneProviderTemplate(id) {
  const template = providerTemplates[id];
  return template ? structuredClone(template) : null;
}
