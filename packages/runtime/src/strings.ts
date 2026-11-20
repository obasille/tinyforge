// Reading AssemblyScript strings out of linear memory.
//
// With the stub runtime, a managed string's payload starts at `ptr` and its
// byte length is the u32 `rtSize` field just before it (ptr - 4). The payload
// is UTF-16LE. This is what @assemblyscript/loader's __getString does, minus
// the loader dependency.

const decoder = new TextDecoder('utf-16le');

export function readString(buffer: ArrayBuffer, ptr: number): string {
  if (!ptr) return '';
  const view = new DataView(buffer);
  if (ptr < 4 || ptr > buffer.byteLength) return `<bad string ptr ${ptr}>`;
  const byteLength = view.getUint32(ptr - 4, true);
  if (byteLength % 2 !== 0 || ptr + byteLength > buffer.byteLength) {
    return `<bad string ptr ${ptr}>`;
  }
  return decoder.decode(new Uint8Array(buffer, ptr, byteLength));
}

/** Replace each `{}` in `template` with the next defined parameter, in order. */
export function interpolate(template: string, params: ReadonlyArray<bigint | number | undefined>): string {
  return params
    .filter((p) => p !== undefined)
    .reduce<string>((str, param) => str.replace('{}', String(param)), template);
}
