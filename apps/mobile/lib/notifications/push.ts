/**
 * Push notification registration stub.
 *
 * TODO(push): blocked on push_tokens migration + producer fan-out — see roadmap §1.5.
 *
 * This is a deliberate no-op placeholder that documents the integration seam.
 * When the DB migration (push_tokens table + RLS) and server-side fan-out
 * producer land, replace this body with:
 *   1. expo-notifications permission request
 *   2. getExpoPushTokenAsync()
 *   3. upsert the token into push_tokens for the current staff member
 *
 * Do NOT call this function from any critical path — it is intentionally inert.
 */
export async function registerForPushNotificationsAsync(): Promise<null> {
  // TODO(push): blocked on push_tokens migration + producer fan-out — see roadmap §1.5
  return null;
}
