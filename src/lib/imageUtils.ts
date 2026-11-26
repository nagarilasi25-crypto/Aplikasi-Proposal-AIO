export function isSafeImageUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/api/uploads/')) return true;
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function processImageFileToDataUrl(
  file: File,
  options: {
    maxDimension: number;
    quality?: number;
    preserveAlpha?: boolean;
  }
): Promise<string> {
  const { maxDimension, quality = 0.85, preserveAlpha = false } = options;

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Gagal membaca berkas gambar.'));
      }
    };
    reader.onerror = () => reject(new Error('Gagal membaca berkas gambar.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Format gambar tidak dapat diproses oleh peramban.'));
    image.src = rawDataUrl;
  });

  const srcWidth = img.naturalWidth || img.width || 1;
  const srcHeight = img.naturalHeight || img.height || 1;
  const scale = Math.min(1, maxDimension / Math.max(srcWidth, srcHeight));
  const targetWidth = Math.max(1, Math.round(srcWidth * scale));
  const targetHeight = Math.max(1, Math.round(srcHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Peramban tidak mendukung pemrosesan gambar.');
  }

  if (!preserveAlpha) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  }
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  if (preserveAlpha) {
    const pngData = canvas.toDataURL('image/png');
    if (pngData.length <= 900_000) {
      return pngData;
    }
    const webpData = canvas.toDataURL('image/webp', quality);
    if (webpData.startsWith('data:image/webp')) {
      return webpData;
    }
  }

  return canvas.toDataURL('image/jpeg', quality);
}
