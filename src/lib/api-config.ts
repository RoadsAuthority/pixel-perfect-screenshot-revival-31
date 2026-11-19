/**
 * The clinic archive API endpoint baked in at build time.
 *
 * Set VITE_ARCHIVE_API_URL (in Lovable's environment settings or a local
 * `.env.local`) to the API Gateway / Lambda URL, e.g.
 *   https://abc123.execute-api.eu-north-1.amazonaws.com/archive
 * When it is set, sign-in defaults to Live API mode. The URL is not a secret:
 * AWS still validates the PIN and enforces access on every request.
 */
export const DEFAULT_API_URL: string = (import.meta.env['VITE_ARCHIVE_API_URL'] ?? '').trim();
