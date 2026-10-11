package com.you.jarvis;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.BlurMaskFilter;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

public final class JarvisOverlay {
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static WindowManager manager;
    private static WaveView view;
    private static Runnable hideTask;

    private JarvisOverlay() {}

    public static boolean show(Context context, String state) {
        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(context)) {
            return false;
        }

        main.post(() -> {
            try {
                Context app = context.getApplicationContext();

                if (manager == null) {
                    manager = (WindowManager) app.getSystemService(Context.WINDOW_SERVICE);
                }

                if (view == null) {
                    view = new WaveView(app);

                    int type = Build.VERSION.SDK_INT >= 26
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE;

                    WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.MATCH_PARENT,
                        dp(app, 76),
                        type,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                        PixelFormat.TRANSLUCENT
                    );

                    lp.gravity = Gravity.BOTTOM;
                    manager.addView(view, lp);
                }

                view.state = state == null ? "listening" : state;
                view.start();

                if (hideTask != null) main.removeCallbacks(hideTask);
                hideTask = JarvisOverlay::hide;
                main.postDelayed(hideTask, 20000L);
            } catch (Exception e) {
                removeView();
            }
        });

        return true;
    }

    public static void hide() {
        main.post(() -> {
            if (hideTask != null) main.removeCallbacks(hideTask);
            hideTask = null;
            removeView();
        });
    }

    private static void removeView() {
        if (view != null && manager != null) {
            try {
                manager.removeView(view);
            } catch (Exception ignored) {}
        }
        view = null;
    }

    private static int dp(Context context, int value) {
        return (int) (value
            * context.getResources().getDisplayMetrics().density + 0.5f);
    }

    private static final class WaveView extends View {
        private final Paint glow = new Paint(3);
        private final Paint line = new Paint(3);
        private long startAt = System.currentTimeMillis();
        private String state = "listening";

        WaveView(Context context) {
            super(context);
            setLayerType(View.LAYER_TYPE_SOFTWARE, null);

            glow.setStyle(Paint.Style.STROKE);
            glow.setStrokeWidth(dp(context, 7));
            glow.setColor(0xff00aaff);
            glow.setMaskFilter(
                new BlurMaskFilter(dp(context, 8), BlurMaskFilter.Blur.NORMAL)
            );

            line.setStyle(Paint.Style.STROKE);
            line.setStrokeWidth(dp(context, 2));
            line.setColor(0xff8df5ff);
        }

        void start() {
            startAt = System.currentTimeMillis();
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);

            float width = getWidth();
            float height = getHeight();
            float phase = (System.currentTimeMillis() - startAt) / 260.0f;
            float amplitude = state.equals("thinking")
                ? height * 0.17f : height * 0.25f;

            for (int layer = 0; layer < 3; layer++) {
                Path path = new Path();
                float offset = height * (0.72f + layer * 0.035f);

                for (int x = 0; x <= (int) width; x += 5) {
                    float y = offset
                        + (float) Math.sin(x * 0.018f + phase + layer) * amplitude
                        + (float) Math.sin(x * 0.008f - phase * 0.7f)
                            * amplitude * 0.35f;

                    if (x == 0) path.moveTo(x, y);
                    else path.lineTo(x, y);
                }

                canvas.drawPath(path, glow);
                canvas.drawPath(path, line);
            }

            postInvalidateDelayed(40);
        }
    }
}
