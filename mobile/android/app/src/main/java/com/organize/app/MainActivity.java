package com.organize.app;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;
import org.json.JSONException;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
  private static final int MAX_INJECT_ATTEMPTS = 40;
  private static final long INJECT_RETRY_DELAY_MS = 500;

  private String pendingShareJson;
  private int injectAttempts = 0;
  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleShareIntent(intent);
  }

  @Override
  public void onCreate(android.os.Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    handleShareIntent(getIntent());
  }

  /** 系统分享（ACTION_SEND text/*）：提取文本，等 Web 侧就绪后注入事件（冷启动时 WebView 尚未加载，需轮询） */
  private void handleShareIntent(Intent intent) {
    if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
    String type = intent.getType();
    if (type == null || !type.startsWith("text/")) return;
    String text = intent.getStringExtra(Intent.EXTRA_TEXT);
    if (text == null || text.isEmpty()) return;
    String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
    try {
      JSONObject payload = new JSONObject();
      payload.put("text", text);
      payload.put("title", subject == null ? "" : subject);
      pendingShareJson = payload.toString();
      injectAttempts = 0;
      scheduleInject(0);
    } catch (JSONException ignored) {
    }
  }

  private void scheduleInject(long delayMs) {
    mainHandler.postDelayed(this::attemptInject, delayMs);
  }

  private void attemptInject() {
    if (pendingShareJson == null) return;
    if (bridge == null || bridge.getWebView() == null) {
      retryOrDrop();
      return;
    }
    final String payload = pendingShareJson;
    bridge.getWebView().evaluateJavascript(
      "(function(){if(window.__organizeShareReady){window.dispatchEvent(new CustomEvent('organize:android-share',{detail:" + payload + "}));return 'ok';}return 'wait';})()",
      (value) -> {
        if (value != null && value.contains("ok")) {
          pendingShareJson = null;
        } else {
          retryOrDrop();
        }
      }
    );
  }

  private void retryOrDrop() {
    injectAttempts += 1;
    if (injectAttempts <= MAX_INJECT_ATTEMPTS) {
      scheduleInject(INJECT_RETRY_DELAY_MS);
    } else {
      // 约 20 秒仍未就绪（如 Web 加载失败）：放弃本次分享，避免无限轮询
      pendingShareJson = null;
    }
  }
}
