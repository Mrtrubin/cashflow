"use client";

// JS 解析规则的执行沙箱。
//
// 规则脚本属于「用户代码」，因此不放进主页面上下文执行：
//   * 使用 sandbox="allow-scripts"（无 allow-same-origin）的 iframe，源为不透明源，
//     拿不到父页面的 DOM、IndexedDB、localStorage 与 cookie；
//   * 每次解析新建 iframe，执行完即销毁；
//   * 超过 3 秒未返回视为超时，直接终止，避免死循环卡死页面。
// 注意：脚本规则只保存在本机，不参与云端同步，也不会在服务端执行。

export interface ScriptContext {
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{
    id: string;
    name: string;
    kind: string;
    parentId: string | null;
  }>;
  defaultAccountId: string | null;
  today: string;
}

export interface ScriptOutcome {
  value: Record<string, unknown> | null;
  error: string | null;
}

const TIMEOUT_MS = 3000;

const BOOTSTRAP = `
(function () {
  var send = function (message) { parent.postMessage(message, "*"); };
  addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "run") return;
    var fn;
    try {
      fn = new Function("line", "ctx", "index", data.script);
    } catch (error) {
      send({ type: "failed", message: "脚本语法错误：" + String((error && error.message) || error) });
      return;
    }
    var rows = [];
    for (var i = 0; i < data.lines.length; i++) {
      try {
        var value = fn(data.lines[i], data.ctx, i);
        rows.push({ value: value === undefined ? null : value, error: null });
      } catch (error) {
        rows.push({ value: null, error: String((error && error.message) || error) });
      }
    }
    send({ type: "done", rows: rows });
  });
  send({ type: "ready" });
})();
`;

export function runScriptRule(
  script: string,
  lines: string[],
  ctx: ScriptContext,
  timeoutMs = TIMEOUT_MS,
): Promise<ScriptOutcome[]> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("脚本规则只能在浏览器中执行"));
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("tabindex", "-1");
    iframe.style.cssText =
      "position:absolute;left:-9999px;top:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
    iframe.srcdoc = `<!doctype html><meta charset="utf-8"><script>${BOOTSTRAP}</script>`;

    let settled = false;

    const cleanup = () => {
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      iframe.remove();
    };

    const fail = (message: string) => {
      if (settled) return;
      cleanup();
      reject(new Error(message));
    };

    const timer = window.setTimeout(() => {
      fail(`脚本执行超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`);
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as {
        type?: string;
        rows?: ScriptOutcome[];
        message?: string;
      };
      if (!data || typeof data !== "object") return;

      if (data.type === "ready") {
        iframe.contentWindow?.postMessage(
          { type: "run", script, lines, ctx },
          "*",
        );
        return;
      }
      if (data.type === "done" && Array.isArray(data.rows)) {
        if (settled) return;
        const rows = data.rows;
        cleanup();
        resolve(rows);
        return;
      }
      if (data.type === "failed") {
        fail(data.message ?? "脚本执行失败");
      }
    }

    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);
  });
}
