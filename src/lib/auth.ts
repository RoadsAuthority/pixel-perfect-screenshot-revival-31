/**
 * Client-side session shape.
 *
 * Rules:
 * - No document content and no PINs are stored here.
 * - The token is opaque; the server re-validates it on every request and is
 *   authoritative for every access decision. Groups are for display only.
 */

export type AuthSession = {
  user_id: string;
  name: string;
  /** Primary access group in lower case, e.g. 'doctors'. Display only. */
  role: string;
  /** Access groups returned by the server, e.g. ['Doctors', 'Everyone']. Display only. */
  groups: string[];
  /** Plain-language description of what this user can read. */
  scope: string;
  /** Opaque bearer token returned by the verify action. */
  token: string;
  /** HTTPS API endpoint this session was verified against. */
  api_url: string;
  /** ISO timestamp of when the session was established. */
  established_at: string;
};

/** Staff groups (everything except the implicit 'Everyone'). */
export function staffGroups(session: Pick<AuthSession, 'groups'> | null): string[] {
  return (session?.groups ?? []).filter((g) => g !== 'Everyone');
}

/** Parse and validate a verify response. Throws a user-visible error if invalid. */
export function sessionFromVerify(data: Record<string, unknown>, userId: string, apiUrl: string): AuthSession {
  if (data['authenticated'] !== true && data['verified'] !== true) {
    throw new Error('The clinic service must explicitly confirm your ID and PIN before access is granted.');
  }
  const groups = Array.isArray(data['groups']) ? data['groups'].filter((g): g is string => typeof g === 'string') : [];
  const token = typeof data['token'] === 'string' ? data['token'] : '';
  const scope = typeof data['scope'] === 'string' ? data['scope'] : '';
  const role = typeof data['role'] === 'string' ? data['role'] : '';
  if (data['user_id'] !== userId || !token || !role || staffGroups({ groups }).length === 0) {
    throw new Error('The clinic service did not return a valid identity, access groups, or token.');
  }
  return {
    user_id: userId,
    name: typeof data['name'] === 'string' ? data['name'] : userId,
    role,
    groups,
    scope,
    token,
    api_url: apiUrl,
    established_at: new Date().toISOString(),
  };
}
