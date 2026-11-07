export const OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY = "zcode.cua/official-frame-integrity-v1";

export const OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION = "official_cua_frame_v1";

export const OFFICIAL_CUA_IMAGE_INLINE_BASE64_BYTES = 200 * 1024;

export function isOfficialCuaImageRefText(text) {
  return parseFrame(text) !== undefined;
}

export function containsOfficialCuaImageRefCredentialText(text) {
  return isOfficialCuaImageRefText(text);
}

export function containsImageRefAuthority(text) {
  return isOfficialCuaImageRefText(text);
}

export function parseOfficialCuaImageRef(text) {
  const ref = parseFrame(text);
  return ref ? { ...ref, authority: ref.frame_id } : undefined;
}

export function readRasterEnvelopeIdentity(input) {
  return rasterIdentity(input);
}

export async function preserveOfficialCuaFrameResult(result) {
  return preserveFrame(result);
}

export function attestOfficialCuaFrameContent(content, expectedKind) {
  return attestFrame(content, expectedKind);
}

export function findOfficialCuaFrameContentPair(content) {
  return framePair(content);
}
import {
  parseFrame,
  framePair,
  rasterIdentity,
  attestFrame,
  preserveFrame,
} from "./windows/index.js";
