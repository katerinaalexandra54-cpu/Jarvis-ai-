package com.you.jarvis;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(JarvisPhonePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
