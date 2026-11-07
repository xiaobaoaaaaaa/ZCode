import { createHash } from "node:crypto";

export const integrityKey = "zcode.cua/official-frame-integrity-v1";
export const protectionKind = "official_cua_frame_v1";
export function parseFrame(text) {
  if (typeof text !== "string") return undefined;
  try {
    const object = JSON.parse(text);
    const ref = object?.image_ref;
    return object &&
      Object.keys(object).length === 1 &&
      ref &&
      typeof ref.frame_id === "string" &&
      Number.isInteger(ref.width) &&
      ref.width > 0 &&
      Number.isInteger(ref.height) &&
      ref.height > 0
      ? ref
      : undefined;
  } catch {
    return undefined;
  }
}
export function framePair(content) {
  if (!Array.isArray(content)) return undefined;
  const images = content.flatMap((block, index) => (block?.type === "image" ? [index] : []));
  if (images.length !== 1) return undefined;
  const imageIndex = images[0];
  const imageRefIndex = imageIndex + 1;
  const imageRef = content[imageRefIndex];
  if (imageRef?.type !== "text" || !parseFrame(imageRef.text)) return undefined;
  return { image: content[imageIndex], imageRef, imageIndex, imageRefIndex };
}
export function rasterIdentity(image) {
  const encoded =
    image?.data ??
    (typeof image?.dataUrl === "string" && image.dataUrl.startsWith("data:image/png;base64,")
      ? image.dataUrl.slice(22)
      : undefined);
  if (typeof encoded !== "string" || encoded.length > 12 * 1024 * 1024) return undefined;
  const data = Buffer.from(encoded, "base64");
  if (data.length < 24 || data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    return undefined;
  return {
    algorithm: "sha256",
    sha256: createHash("sha256").update(data).digest("hex"),
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}
export function attestFrame(content, expectedKind = protectionKind) {
  const pair = framePair(content);
  if (!pair || pair.imageIndex !== 0 || expectedKind !== protectionKind) return undefined;
  const ref = parseFrame(pair.imageRef.text);
  const raster = rasterIdentity(pair.image);
  if (
    !raster ||
    ref.sha256 !== raster.sha256 ||
    ref.width !== raster.width ||
    ref.height !== raster.height
  )
    return undefined;
  return { kind: protectionKind };
}
export async function preserveFrame(result) {
  if (!Array.isArray(result?.content) || !result.content.some((b) => b?.type === "image"))
    return result;
  const pair = framePair(result.content);
  const meta = result._meta?.[integrityKey];
  const ref = pair && parseFrame(pair.imageRef.text);
  const raster = pair && rasterIdentity(pair.image);
  if (
    !pair ||
    pair.imageIndex !== 0 ||
    !meta ||
    meta.version !== 1 ||
    meta.media_type !== "image/png" ||
    !raster ||
    meta.frame_id !== ref.frame_id ||
    meta.sha256 !== raster.sha256 ||
    meta.width !== raster.width ||
    meta.height !== raster.height ||
    ref.width !== raster.width ||
    ref.height !== raster.height ||
    (ref.sha256 !== undefined && ref.sha256 !== raster.sha256)
  ) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Computer Use screenshot integrity failed. Observe a new screenshot; do not use coordinates from this result.",
        },
      ],
    };
  }
  // 保持既有原帧合同的对象与字节不变；新后端在产生引用时即附带最终校验所需摘要。
  return result;
}
