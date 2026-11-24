const retryableDatabaseCodes = new Set(['57014', '55P03', '40P01', '40001', 'PGRST003']);

export function isRetryableDatabaseCode(code?: string) {
  return code !== undefined && retryableDatabaseCodes.has(code);
}
