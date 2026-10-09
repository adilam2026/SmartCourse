/** Longest side kept before upload: the server normalises to 512 px, so more is wasted mobile data. */
const MAX_SIDE = 1024;

const blobToBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

/**
 * Shrinks a gallery picture or a camera photo (often 4–12 MB) to a small JPEG, no cropping, and returns it
 * as base64 together with a blob URL for the preview. Throws when the file is not a readable image.
 */
export async function prepareImage(file: Blob): Promise<{ base64: string; previewUrl: string }> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  try {
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.85));
    return { base64: await blobToBase64(out), previewUrl: URL.createObjectURL(out) };
  } finally {
    bmp.close();
  }
}
