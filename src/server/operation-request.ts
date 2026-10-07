export type OperationInput = Record<string, unknown>;

const pathParameter = /\{([A-Za-z][A-Za-z0-9_-]*)\}|\/:([A-Za-z][A-Za-z0-9_-]*)/g;

/** Resolve template path parameters and remove them from the upstream JSON body/query. */
export function resolveOperationRequest(path: string, input: OperationInput) {
  const remainingInput = { ...input };
  const resolvedPath = path.replace(pathParameter, (_match, braceName: string | undefined, colonName: string | undefined) => {
    const name = braceName ?? colonName;
    if (!name) throw new Error('Invalid path parameter template.');
    const value = remainingInput[name];
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw Object.assign(new Error(`Provide path parameter '${name}'.`), { status: 400 });
    }
    delete remainingInput[name];
    const encoded = encodeURIComponent(String(value));
    return colonName ? `/${encoded}` : encoded;
  });
  return { path: resolvedPath, input: remainingInput };
}
