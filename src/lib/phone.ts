/**
 * Normaliza un número de teléfono eliminando espacios, guiones y prefijo español (+34 / 0034)
 * para permitir emparejar cuentas y acompañantes de forma fiable.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (!digits) return '';

  // Normalizar prefijo internacional de España (0034 o +34 o 34 seguido de 9 dígitos)
  if (digits.startsWith('0034') && digits.length === 13) {
    return digits.slice(4);
  }
  if ((hasPlus || digits.length === 11) && digits.startsWith('34') && digits.length === 11) {
    return digits.slice(2);
  }

  return digits;
}

export function isValidPhone(raw: string): boolean {
  const normalized = normalizePhone(raw);
  return normalized.length >= 9 && normalized.length <= 15;
}

export function formatPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return '-';
  const norm = normalizePhone(raw);
  if (norm.length === 9) {
    return `${norm.slice(0, 3)} ${norm.slice(3, 6)} ${norm.slice(6)}`;
  }
  return norm;
}
