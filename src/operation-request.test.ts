import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOperationRequest } from './server/operation-request.js';

test('resolves brace path parameters and removes them from a JSON body', () => {
  const result = resolveOperationRequest('/v1/models/{model}:generateContent', {
    model: 'gemini 3.5/flash',
    contents: [{ parts: [{ text: 'hello' }] }],
  });
  assert.equal(result.path, '/v1/models/gemini%203.5%2Fflash:generateContent');
  assert.deepEqual(result.input, { contents: [{ parts: [{ text: 'hello' }] }] });
});

test('resolves colon path parameters', () => {
  const result = resolveOperationRequest('/v1/text-to-speech/:voice_id/with-timestamps', {
    voice_id: 'voice/id', text: 'hello',
  });
  assert.equal(result.path, '/v1/text-to-speech/voice%2Fid/with-timestamps');
  assert.deepEqual(result.input, { text: 'hello' });
});

test('rejects a missing path parameter', () => {
  assert.throws(
    () => resolveOperationRequest('/v1/files/{file_id}', {}),
    error => error instanceof Error && error.message === "Provide path parameter 'file_id'." && error.status === 400,
  );
});
