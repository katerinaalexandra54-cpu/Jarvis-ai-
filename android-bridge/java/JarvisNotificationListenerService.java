package com.you.jarvis;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.os.Bundle;

/**
 * Optional notification bridge. Android requires the user to grant notification
 * access manually. Content capture is disabled by default and is enabled only
 * for a short, explicit JARVIS read request.
 */
public class JarvisNotificationListenerService extends NotificationListenerService {
    private static volatile JarvisNotificationListenerService instance;
    private static volatile boolean captureEnabled = false;
    private static volatile String packageName = "";
    private static volatile String appLabel = "";
    private static volatile String title = "";
    private static volatile String text = "";
    private static volatile long timestamp = 0L;

    public static void setCaptureEnabled(boolean enabled) { captureEnabled = enabled; if (!enabled) clear(); }
    public static synchronized void clear() { packageName = ""; appLabel = ""; title = ""; text = ""; timestamp = 0L; }
    public static synchronized android.content.ContentValues latest() {
        android.content.ContentValues values = new android.content.ContentValues();
        values.put("packageName", packageName); values.put("appLabel", appLabel);
        values.put("title", title); values.put("text", text); values.put("timestamp", timestamp);
        return values;
    }
    public static void readLatestExplicit() {
        JarvisNotificationListenerService service = instance;
        if (!captureEnabled || service == null) return;
        StatusBarNotification[] active = service.getActiveNotifications();
        if (active == null) return;
        StatusBarNotification newest = null;
        for (StatusBarNotification sbn : active) {
            if (sbn != null && sbn.getNotification() != null &&
                (newest == null || sbn.getPostTime() > newest.getPostTime())) {
                newest = sbn;
            }
        }
        if (newest != null) service.capture(newest);
    }

    @Override public void onListenerConnected() { instance = this; }
    @Override public void onListenerDisconnected() { if (instance == this) instance = null; }

    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        if (!captureEnabled || sbn == null || sbn.getNotification() == null) return;
        capture(sbn);
    }

    private void capture(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;
        Bundle extras = sbn.getNotification().extras;
        if (extras == null) return;
        CharSequence t = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence body = extras.getCharSequence(Notification.EXTRA_TEXT);
        synchronized (JarvisNotificationListenerService.class) {
            packageName = sbn.getPackageName() == null ? "" : sbn.getPackageName();
            appLabel = packageName;
            try {
                android.content.pm.ApplicationInfo info = getPackageManager().getApplicationInfo(packageName, 0);
                CharSequence label = getPackageManager().getApplicationLabel(info);
                if (label != null) appLabel = String.valueOf(label);
            } catch (Exception ignored) { }
            title = t == null ? "" : String.valueOf(t);
            text = body == null ? "" : String.valueOf(body);
            timestamp = sbn.getPostTime();
        }
    }
}
