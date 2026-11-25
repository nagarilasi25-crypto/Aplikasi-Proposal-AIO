export function formatRupiah(amount: number | undefined | null): string {
  const numeric = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(numeric);
}

export function formatAngka(amount: number | undefined | null): string {
  const numeric = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('id-ID').format(numeric);
}

export function formatTanggalIndonesia(value: unknown): string {
  if (!value) return '-';
  try {
    let dateObj: Date | null = null;
    if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
      dateObj = (value as { toDate: () => Date }).toDate();
    } else if (value instanceof Date) {
      dateObj = value;
    } else if (typeof value === 'string' || typeof value === 'number') {
      dateObj = new Date(value);
    }
    if (!dateObj || Number.isNaN(dateObj.getTime())) return '-';
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(dateObj);
  } catch {
    return '-';
  }
}

export function sanitizeString(value: string | undefined | null, maxLength: number): string {
  if (!value) return '';
  return value.trim().slice(0, maxLength);
}

export function sanitizeNumber(value: unknown, min = 0, max = 1000000): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, Math.floor(num)));
}
