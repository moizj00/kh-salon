// Sealing for what the outbox keeps on the phone (P1-09; doc 05 asks for an encrypted cache).
// AES-GCM with a non-extractable key in IndexedDB.

const ALGORITHM = "AES-GCM";
const KEY_BITS = 256;
const IV_BYTES = 12;
const CHUNK_BYTES = 0x8000;

export const newKey = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_BITS }, false, ["encrypt", "decrypt"]);

const toBase64 = (bytes: Uint8Array): string => {
  const chunks = Array.from({ length: Math.ceil(bytes.length / CHUNK_BYTES) }, (_, index) =>
    String.fromCharCode(...bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)),
  );
  return btoa(chunks.join(""));
};

const fromBase64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/** Seals a JSON value. The result is base64 of a fresh random IV followed by the ciphertext. */
export async function sealJson(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(JSON.stringify(value ?? null));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, plain));
  const packed = new Uint8Array(IV_BYTES + sealed.length);
  packed.set(iv);
  packed.set(sealed, IV_BYTES);
  return toBase64(packed);
}

/** Opens what `sealJson` made. Throws when the key is invalid or data altered. */
export async function openJson<T>(key: CryptoKey, sealed: string): Promise<T> {
  const packed = fromBase64(sealed);
  const iv = packed.subarray(0, IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, packed.subarray(IV_BYTES));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
