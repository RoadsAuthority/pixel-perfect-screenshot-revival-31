/**
 * The clinic archive API endpoint.
 *
 * Defaults to the Render backend. Override with VITE_ARCHIVE_API_URL (e.g. in
 * `.env.local`) to point at another deployment. The URL is not a secret: the
 * server still validates the PIN and enforces access on every request.
 */
const RENDER_API_URL = 'https://aws-system.onrender.com/archive';

export const DEFAULT_API_URL: string = (import.meta.env['VITE_ARCHIVE_API_URL'] ?? '').trim() || RENDER_API_URL;
