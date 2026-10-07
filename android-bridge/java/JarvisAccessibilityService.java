package com.you.jarvis;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Intent;
import android.graphics.Path;
import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityEvent;

import java.util.ArrayList;
import java.util.List;

/**
 * User-controlled JARVIS Phone Control service. It performs only an explicit
 * requested action; it does not capture credentials or passively inspect text.
 */
public class JarvisAccessibilityService extends AccessibilityService {
    public static JarvisAccessibilityService instance;

    @Override protected void onServiceConnected() { super.onServiceConnected(); instance = this; }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) { }
    @Override public void onInterrupt() { }
    @Override public boolean onUnbind(Intent intent) { instance = null; return super.onUnbind(intent); }

    private List<AccessibilityNodeInfo> nodes(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> out = new ArrayList<>();
        if (root == null) return out;
        out.add(root);
        for (int i = 0; i < root.getChildCount(); i++) out.addAll(nodes(root.getChild(i)));
        return out;
    }

    public boolean clickText(String wanted) {
        String q = wanted == null ? "" : wanted.trim().toLowerCase();
        if (q.isEmpty()) return false;
        for (AccessibilityNodeInfo node : nodes(getRootInActiveWindow())) {
            CharSequence text = node.getText();
            CharSequence desc = node.getContentDescription();
            String value = String.valueOf(text == null ? desc : text).toLowerCase();
            if (value.contains(q) && node.isVisibleToUser() && node.isClickable()) {
                return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            }
        }
        return false;
    }

    public boolean scroll(String direction) {
        int action = "up".equalsIgnoreCase(direction) || "back".equalsIgnoreCase(direction)
                ? AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                : AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
        for (AccessibilityNodeInfo node : nodes(getRootInActiveWindow())) {
            if (node.isVisibleToUser() && node.isScrollable() && node.performAction(action)) return true;
        }
        // Some custom-rendered apps expose no scrollable node; use a visible gesture.
        if (android.os.Build.VERSION.SDK_INT >= 24) {
            android.util.DisplayMetrics m = getResources().getDisplayMetrics();
            float x = m.widthPixels * 0.5f;
            float from = "up".equalsIgnoreCase(direction) || "back".equalsIgnoreCase(direction)
                    ? m.heightPixels * 0.35f : m.heightPixels * 0.70f;
            float to = "up".equalsIgnoreCase(direction) || "back".equalsIgnoreCase(direction)
                    ? m.heightPixels * 0.70f : m.heightPixels * 0.35f;
            Path path = new Path(); path.moveTo(x, from); path.lineTo(x, to);
            return dispatchGesture(new GestureDescription.Builder()
                    .addStroke(new GestureDescription.StrokeDescription(path, 0, 350)).build(), null, null);
        }
        return false;
    }

    public boolean typeText(String text) {
        String value = text == null ? "" : text;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || value.isEmpty()) return false;
        for (AccessibilityNodeInfo node : nodes(root)) {
            if (!node.isVisibleToUser() || !node.isFocused()) continue;
            if (node.isPassword()) return false;
            CharSequence className = node.getClassName();
            if (className != null && String.valueOf(className).toLowerCase().contains("password")) return false;
            Bundle args = new Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value);
            return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        }
        return false;
    }

    public AccessibilityNodeInfo activeRoot() { return getRootInActiveWindow(); }

    public boolean clickSendControl() {
        for (AccessibilityNodeInfo node : nodes(getRootInActiveWindow())) {
            if (!node.isVisibleToUser() || !node.isClickable() || node.isPassword()) continue;
            String text = String.valueOf(node.getText() == null ? node.getContentDescription() : node.getText()).toLowerCase();
            if (text.equals("send") || text.contains("send message") || text.equals("reply") || text.equals("post")) {
                return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            }
        }
        return false;
    }

    public boolean submitFocusedText(String text) {
        if (!typeText(text)) return false;
        return clickSendControl();
    }
}
