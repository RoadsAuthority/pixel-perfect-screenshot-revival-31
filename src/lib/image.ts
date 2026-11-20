export type PreparedImage = { base64: string; type: 'image/jpeg'; previewUrl: string; bytes: number };

/**
 * Shrink a photo to at most `maxSide` pixels and re-encode it as JPEG, so it uploads
 * quickly on a weak connection and stays well under the server's size limit.
 */
export async function prepareImage(file: File, maxSide = 1280, quality = 0.82): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot prepare the photo.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.split(',')[1] ?? '';
  return { base64, type: 'image/jpeg', previewUrl: dataUrl, bytes: Math.round((base64.length * 3) / 4) };
}
