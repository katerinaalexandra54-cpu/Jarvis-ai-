package com.you.jarvis;

import android.content.Context;
import android.content.res.AssetManager;

import org.vosk.Model;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/** Installs the bundled Vosk model atomically so a partial extraction is never reused. */
public final class JarvisVoskModel {
    public static final String ASSET_NAME = "vosk-model-small-en-us-0.15";
    private static final String[] REQUIRED = {
            "am/final.mdl", "conf/model.conf", "conf/mfcc.conf",
            "graph/Gr.fst", "graph/HCLr.fst", "graph/disambig_tid.int",
            "graph/phones/word_boundary.int", "ivector/final.dubm",
            "ivector/final.ie", "ivector/final.mat", "ivector/global_cmvn.stats",
            "ivector/online_cmvn.conf", "ivector/splice.conf"
    };

    private JarvisVoskModel() {}

    public static synchronized Model open(Context context) throws IOException {
        File root = new File(context.getFilesDir(), ASSET_NAME);
        File complete = new File(root, ".complete");
        if (!complete.exists() || !valid(root)) {
            delete(root);
            File staging = new File(context.getFilesDir(), ASSET_NAME + ".staging");
            delete(staging);
            copyTree(context.getAssets(), ASSET_NAME, staging);
            if (!valid(staging)) throw new IOException("Vosk model validation failed: " + describe(staging));
            if (!staging.renameTo(root)) throw new IOException("Could not commit Vosk model at " + root.getAbsolutePath());
            if (!complete.createNewFile()) throw new IOException("Could not mark Vosk model complete at " + complete.getAbsolutePath());
        }
        if (!valid(root)) throw new IOException("Vosk model is incomplete at " + root.getAbsolutePath() + ": " + describe(root));
        try {
            return new Model(root.getAbsolutePath());
        } catch (Throwable error) {
            throw new IOException("Failed to create Vosk model at " + root.getAbsolutePath() + ": " + describe(root), error);
        }
    }

    public static String describe(Context context) {
        return describe(new File(context.getFilesDir(), ASSET_NAME));
    }

    private static String describe(File root) {
        StringBuilder out = new StringBuilder("path=").append(root.getAbsolutePath())
                .append(" exists=").append(root.isDirectory());
        for (String relative : REQUIRED) {
            File f = new File(root, relative);
            out.append(" ").append(relative).append("=").append(f.isFile() && f.length() > 0 ? f.length() : "MISSING");
        }
        return out.toString();
    }

    private static boolean valid(File root) {
        if (!root.isDirectory()) return false;
        for (String relative : REQUIRED) {
            File f = new File(root, relative);
            if (!f.isFile() || f.length() == 0) return false;
        }
        return true;
    }

    private static void copyTree(AssetManager assets, String asset, File target) throws IOException {
        String[] children = assets.list(asset);
        if (children != null && children.length > 0) {
            if (!target.exists() && !target.mkdirs()) throw new IOException("Could not create " + target);
            for (String child : children) copyTree(assets, asset + "/" + child, new File(target, child));
            return;
        }
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("Could not create " + parent);
        try (InputStream in = assets.open(asset); FileOutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[32768]; int n;
            while ((n = in.read(buffer)) != -1) if (n > 0) out.write(buffer, 0, n);
            out.getFD().sync();
        }
    }

    private static void delete(File file) {
        if (!file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) delete(child);
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
