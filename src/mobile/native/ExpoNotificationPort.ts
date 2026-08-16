import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { NotificationPlatformEvent, NotificationPort } from "../../coach/ports";
import { mobileT } from "../../i18n";


const REMINDER_CHANNEL_ID = "maxpower-reminders";

/**
 * Native-only adapter. It owns platform permission/channel concerns, but
 * never reads the Ledger or decides what should be sent.
 */
export function createExpoNotificationPort(): NotificationPort {
  let configured = false;

  const configure = async (): Promise<void> => {
    if (configured) return;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
        name: mobileT("mobile.native.exponotificationport.cd8ed46402"),
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 180],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    configured = true;
  };

  const requestAuthorization = async (): Promise<"granted" | "denied"> => {
    await configure();
    const current = await Notifications.getPermissionsAsync();
    const final = current.granted ? current : await Notifications.requestPermissionsAsync();
    return final.granted ? "granted" : "denied";
  };

  const requireAuthorization = async (): Promise<void> => {
    await configure();
    // Background catch-up must never cause an OS prompt. A foreground settings
    // action asks through `requestAuthorization` before it grants the domain
    // permission; recipes only observe that already-established result.
    const current = await Notifications.getPermissionsAsync();
    if (!current.granted) throw new Error("native_notification_permission_denied");
  };

  const upsert = async (input: { id: string; at: string; title: string; body: string; deepLink?: string }): Promise<void> => {
    const at = new Date(input.at);
    if (!Number.isFinite(at.getTime())) throw new Error("invalid_notification_time");
    await requireAuthorization();
    // Expo respects the caller-provided identifier, so cancel+schedule is a
    // stable replacement even if the user changes a reminder's wall time.
    await Notifications.cancelScheduledNotificationAsync(input.id);
    const identifier = await Notifications.scheduleNotificationAsync({
      identifier: input.id,
      content: {
        title: input.title,
        body: input.body,
        sound: false,
        ...(input.deepLink ? { data: { deepLink: input.deepLink } } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        ...(Platform.OS === "android" ? { channelId: REMINDER_CHANNEL_ID } : {}),
      },
    });
    if (identifier !== input.id) throw new Error("native_notification_identifier_mismatch");
  };

  return {
    requestAuthorization,
    upsert,
    async cancel(id) {
      await Notifications.cancelScheduledNotificationAsync(id);
    },
    async deliveryStatus(id) {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      return scheduled.some((notification) => notification.identifier === id) ? "scheduled" : "unknown";
    },
    observe(listener) {
      const delivered = Notifications.addNotificationReceivedListener((notification) => {
        const event = notificationEvent(notification, "delivered");
        if (event) listener(event);
      });
      const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
        const event = notificationEvent(response.notification, "tap");
        if (event) listener(event);
      });
      return () => {
        delivered.remove();
        tapped.remove();
      };
    },
    async lastInteraction() {
      const response = await Notifications.getLastNotificationResponseAsync();
      return response?.notification ? notificationEvent(response.notification, "tap") : undefined;
    },
  };
}

function notificationEvent(
  notification: Notifications.Notification,
  event: NotificationPlatformEvent["event"],
): NotificationPlatformEvent | undefined {
  const notificationId = notification.request.identifier;
  if (!notificationId) return undefined;
  const deepLink = notification.request.content.data?.deepLink;
  return {
    notificationId,
    event,
    ...(typeof deepLink === "string" ? { deepLink } : {}),
    occurredAt: new Date().toISOString(),
  };
}
