/**
 * Push notification registration for DATUM mobile.
 *
 * This module handles requesting permissions, obtaining an Expo push token,
 * and persisting it to the push_tokens table via @datum/core.
 *
 * Every failure path returns null — this must NEVER throw into the auth flow.
 */
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { upsertPushToken } from "@datum/core";
import { supabase } from "@/lib/supabase/client";

/**
 * Registers the device for push notifications.
 *
 * Returns the Expo push token string on success, null on any failure
 * (not a device, permissions denied, no EAS projectId configured, network error, etc.).
 *
 * Safe to fire-and-forget from the session flow — it will never throw.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    // Guard: physical device only — simulators cannot receive push notifications
    if (!Device.isDevice) {
      return null;
    }

    // Request / check permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      return null;
    }

    // Resolve EAS projectId — required by getExpoPushTokenAsync
    // TODO(push): set EAS projectId in app.json extra.eas.projectId
    const projectId =
      Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      // No projectId configured yet — token cannot be obtained; flag above.
      return null;
    }

    // Obtain the Expo push token
    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResult.data;

    // Persist to push_tokens — failures are swallowed (returns discriminated result)
    await upsertPushToken(supabase, {
      token,
      platform: Platform.OS as "ios" | "android" | "web",
      deviceName: Device.deviceName ?? undefined,
    });

    return token;
  } catch {
    // Never crash app startup
    return null;
  }
}
