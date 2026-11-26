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
    if (
      typeof value === 'object' &&
      value !== null &&
      'toDate' in value &&
      typeof (value as { toDate: () => Date }).toDate === 'function'
    ) {
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

export function formatTanggalLengkapIndonesia(value: unknown): string {
  if (!value) return '-';
  try {
    const dateObj =
      value instanceof Date
        ? value
        : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null;
    if (!dateObj || Number.isNaN(dateObj.getTime())) return '-';
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(dateObj);
  } catch {
    return '-';
  }
}

export function terbilangAngka(n: number): string {
  const clean = Math.floor(Math.abs(Number(n) || 0));
  if (clean === 0) return 'nol';
  const units = [
    '',
    'satu',
    'dua',
    'tiga',
    'empat',
    'lima',
    'enam',
    'tujuh',
    'delapan',
    'sembilan',
    'sepuluh',
    'sebelas',
  ];

  const convert = (num: number): string => {
    if (num < 12) return units[num];
    if (num < 20) return `${units[num - 10]} belas`;
    if (num < 100) {
      const rem = num % 10;
      return `${units[Math.floor(num / 10)]} puluh${rem ? ` ${units[rem]}` : ''}`;
    }
    if (num < 200) {
      const rem = num % 100;
      return `seratus${rem ? ` ${convert(rem)}` : ''}`;
    }
    if (num < 1000) {
      const rem = num % 100;
      return `${units[Math.floor(num / 100)]} ratus${rem ? ` ${convert(rem)}` : ''}`;
    }
    if (num < 2000) {
      const rem = num % 1000;
      return `seribu${rem ? ` ${convert(rem)}` : ''}`;
    }
    if (num < 1_000_000) {
      const rem = num % 1000;
      return `${convert(Math.floor(num / 1000))} ribu${rem ? ` ${convert(rem)}` : ''}`;
    }
    if (num < 1_000_000_000) {
      const rem = num % 1_000_000;
      return `${convert(Math.floor(num / 1_000_000))} juta${rem ? ` ${convert(rem)}` : ''}`;
    }
    if (num < 1_000_000_000_000) {
      const rem = num % 1_000_000_000;
      return `${convert(Math.floor(num / 1_000_000_000))} miliar${rem ? ` ${convert(rem)}` : ''}`;
    }
    return String(num);
  };

  return convert(clean).replace(/\s+/g, ' ').trim();
}

export function terbilangRupiah(n: number): string {
  const words = terbilangAngka(n);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} rupiah`;
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

export function generateProposalNumber(
  prefix: string,
  sequenceCount: number,
  categoryCode = 'UMM',
  year = new Date().getFullYear()
): string {
  const cleanPrefix = (prefix || 'PROP/RQ-AR').trim();
  const seq = String(Math.max(1, sequenceCount)).padStart(3, '0');
  const code = (categoryCode || 'UMM').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'UMM';
  return `${seq}/${cleanPrefix}/${code}/${year}`;
}
