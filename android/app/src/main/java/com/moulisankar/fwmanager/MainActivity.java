package com.moulisankar.fwmanager;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WebPrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
