package com.you.jarvis;

import android.content.Context;
import android.graphics.*;
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
    private static OrbView view;
    private static Runnable hideTask;

    private JarvisOverlay() {}

    public static boolean show(Context context, String state) {
        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(context))
            return false;

        main.post(() -> {
            try {
                Context app = context.getApplicationContext();
                if (manager == null)
                    manager = (WindowManager) app.getSystemService(Context.WINDOW_SERVICE);

                if (view == null) {
                    view = new OrbView(app);
                    int type = Build.VERSION.SDK_INT >= 26
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE;

                    WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.MATCH_PARENT,
                        dp(app, 224),
                        type,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                        PixelFormat.TRANSLUCENT
                    );
                    lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
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
            try { manager.removeView(view); } catch (Exception ignored) {}
        }
        view = null;
    }

    private static int dp(Context c, int n) {
        return (int) (n * c.getResources().getDisplayMetrics().density + 0.5f);
    }

    private static float dpf(Context c, float n) {
        return n * c.getResources().getDisplayMetrics().density;
    }

    private static final class OrbView extends View {
        private final Paint fill = new Paint(3);
        private final Paint rim = new Paint(3);
        private final Paint glow = new Paint(3);
        private final Paint wave = new Paint(3);
        private final Paint stars = new Paint(3);
        private long started = System.currentTimeMillis();
        private String state = "listening";

        OrbView(Context c) {
            super(c);
            setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            fill.setStyle(Paint.Style.FILL);
            rim.setStyle(Paint.Style.STROKE);
            rim.setStrokeWidth(dp(c, 2));
            glow.setStyle(Paint.Style.STROKE);
            glow.setStrokeWidth(dp(c, 5));
            glow.setMaskFilter(new BlurMaskFilter(dp(c, 10), BlurMaskFilter.Blur.NORMAL));
            wave.setStyle(Paint.Style.STROKE);
            wave.setStrokeCap(Paint.Cap.ROUND);
            wave.setStrokeJoin(Paint.Join.ROUND);
            stars.setStyle(Paint.Style.FILL);
        }

        void start() {
            started = System.currentTimeMillis();
            invalidate();
        }

        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float density = getResources().getDisplayMetrics().density;
            float w = getWidth(), h = getHeight();
            float t = (System.currentTimeMillis() - started) / 1000f;
            float cx = w * 0.5f;
            float cy = h * 0.48f;
            float r = Math.min(dp(getContext(), 91), Math.min(w * 0.39f, h * 0.43f));
            boolean thinking = "thinking".equals(state);
            boolean speaking = "speaking".equals(state);
            float pulse = 1f + (float)Math.sin(t * (speaking ? 5f : 2.1f))
                * (speaking ? 0.045f : 0.018f);
            r *= pulse;

            int save = canvas.save();
            canvas.translate(cx, cy);

            // Soft ambient holographic aura.
            glow.setStrokeWidth(dp(getContext(), 9));
            glow.setColor(0x553f75ff);
            canvas.drawCircle(0, 0, r + dp(getContext(), 3), glow);

            // Glass sphere with deep blue center and violet edges.
            fill.setShader(new RadialGradient(
                -r * 0.22f, -r * 0.34f, r * 1.55f,
                new int[] { 0x553c9fff, 0x302a42d8, 0x402c4cff, 0x664d20a8 },
                new float[] { 0f, 0.43f, 0.78f, 1f },
                Shader.TileMode.CLAMP
            ));
            canvas.drawCircle(0, 0, r, fill);
            fill.setShader(null);

            // Multiple translucent glass contours.
            rim.setShader(new SweepGradient(0, 0, new int[] {
                0xffa6faff, 0x667c8fff, 0xff78dcff,
                0xffb8a0ff, 0xff9a76ff, 0xffd9fbff
            }, null));
            canvas.drawCircle(0, 0, r, rim);
            rim.setShader(null);

            glow.setStrokeWidth(dpf(getContext(), 2.2f));
            glow.setColor(0x9978caff);
            canvas.drawCircle(0, 0, r - dp(getContext(), 5), glow);

            rim.setStrokeWidth(dpf(getContext(), 1.1f));
            rim.setColor(0x887bdcff);
            RectF inner = new RectF(-r * 0.88f, -r * 0.91f, r * 0.88f, r * 0.91f);
            canvas.drawOval(inner, rim);

            // Flowing energy ribbon forming a stylized A.
            float drift = (float)Math.sin(t * (thinking ? 0.8f : 1.8f)) * r * 0.07f;
            Path a = new Path();
            a.moveTo(-r * 0.64f, r * 0.35f + drift);
            a.cubicTo(-r * 0.36f, r * 0.48f, -r * 0.12f, -r * 0.45f,
                      -r * 0.02f, -r * 0.53f);
            a.cubicTo(r * 0.16f, -r * 0.62f, r * 0.26f, r * 0.35f,
                      r * 0.61f, r * 0.37f);
            a.cubicTo(r * 0.39f, r * 0.58f, r * 0.14f, r * 0.08f,
                      -r * 0.02f, r * 0.13f);
            a.cubicTo(-r * 0.25f, r * 0.18f, -r * 0.44f, r * 0.52f,
                      -r * 0.64f, r * 0.35f + drift);

            canvas.save();
            canvas.rotate((float)Math.sin(t * 0.35f) * 3f);
            glow.setColor(0xaa706aff);
            glow.setStrokeWidth(dp(getContext(), speaking ? 7 : 5));
            canvas.drawPath(a, glow);

            wave.setStrokeWidth(dpf(getContext(), 2.3f));
            wave.setShader(new LinearGradient(
                -r, -r * 0.5f, r, r * 0.5f,
                new int[] { 0xffa4ffff, 0xff65cfff, 0xffd2a0ff, 0xfff0d8ff },
                null, Shader.TileMode.CLAMP
            ));
            canvas.drawPath(a, wave);
            wave.setShader(null);
            canvas.restore();

            // A second fine ribbon creates the layered, flowing-glass effect.
            Path ribbon = new Path();
            ribbon.moveTo(-r * 0.82f, -r * 0.12f);
            ribbon.cubicTo(-r * 0.25f, -r * 0.78f,
                           r * 0.25f, r * 0.79f, r * 0.82f, r * 0.04f);
            rim.setStrokeWidth(dpf(getContext(), 1.3f));
            rim.setColor(0x9979dcff);
            canvas.drawPath(ribbon, rim);

            // Small, subdued points of light inside the orb.
            for (int i = 0; i < 12; i++) {
                double angle = i * 2.399 + t * 0.12;
                float rr = r * (0.38f + 0.43f * ((i % 4) / 4f));
                float x = (float)Math.cos(angle) * rr;
                float y = (float)Math.sin(angle) * rr;
                stars.setColor(i % 3 == 0 ? 0x9978dfff : 0x557c8fff);
                canvas.drawCircle(x, y, dpf(getContext(), i % 3 == 0 ? 1.5f : 0.8f), stars);
            }

            canvas.restoreToCount(save);
            postInvalidateDelayed(33);
        }
    }
}
