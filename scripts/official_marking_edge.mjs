#!/usr/bin/env node

import fs from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";

const OFFICIAL_URL = "https://ol.dhlottery.co.kr/olotto/game/game645.do";
const BROWSER_CANDIDATES = [
  {
    name: "Google Chrome",
    paths: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ],
  },
  {
    name: "Microsoft Edge",
    paths: [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
  },
];

function parseArgs(argv) {
  const parsed = {
    ticketNo: "1",
    timeoutMs: 45000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--ticket-no") {
      parsed.ticketNo = argv[index + 1] || "1";
      index += 1;
      continue;
    }
    if (current === "--numbers") {
      parsed.numbers = (argv[index + 1] || "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value));
      index += 1;
      continue;
    }
    if (current === "--timeout-ms") {
      parsed.timeoutMs = Number(argv[index + 1] || "45000");
      index += 1;
    }
  }

  if (!parsed.numbers || parsed.numbers.length !== 6) {
    throw new Error("--numbers must contain 6 comma-separated integers.");
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function choosePort() {
  return 9222 + Math.floor(Math.random() * 400);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function chooseBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    for (const browserPath of candidate.paths) {
      if (fs.existsSync(browserPath)) {
        return { name: candidate.name, path: browserPath };
      }
    }
  }
  throw new Error("Google Chrome or Microsoft Edge executable not found.");
}

function readWindowsHostCandidates() {
  try {
    const resolvConf = fs.readFileSync("/etc/resolv.conf", "utf8");
    const nameservers = resolvConf
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("nameserver "))
      .map((line) => line.split(/\s+/)[1])
      .filter(Boolean);
    return nameservers;
  } catch {
    return [];
  }
}

function buildDebugHosts() {
  const envHosts = String(process.env.OFFICIAL_MARKING_DEBUG_HOSTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return unique(["127.0.0.1", "localhost", "host.docker.internal", ...envHosts, ...readWindowsHostCandidates()]);
}

function rewriteWebSocketHost(wsUrl, host) {
  const parsed = new URL(wsUrl);
  parsed.hostname = host;
  return parsed.toString();
}

async function launchEdge({ port }) {
  const profileName = `lottobang-edge-${port}`;
  const browser = chooseBrowser();
  const profile = fs.mkdtempSync(`${process.env.TEMP || process.env.TMP || "."}\\${profileName}-`);
  const child = spawn(
    browser.path,
    [
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      OFFICIAL_URL,
    ],
    {
      cwd: browser.path.replace(/\\[^\\]+$/, ""),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    },
  );
  child.unref();
  await sleep(800);
}
async function waitForPageTarget({ port, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  const debugHosts = buildDebugHosts();
  let lastError = null;
  while (Date.now() < deadline) {
    for (const host of debugHosts) {
      try {
        const response = await fetch(`http://${host}:${port}/json/list`);
        if (!response.ok) {
          throw new Error(`CDP list request failed with ${response.status}`);
        }
        const targets = await response.json();
        const pages = targets.filter((target) => target.type === "page");
        const matching = pages.filter((target) => {
          const url = String(target.url || "");
          return url.includes("/olotto/game/game645.do");
        });
        const target = matching.at(-1) || pages.at(-1);
        if (target?.webSocketDebuggerUrl) {
          return {
            ...target,
            debugHost: host,
            webSocketDebuggerUrl: rewriteWebSocketHost(target.webSocketDebuggerUrl, host),
          };
        }
      } catch (error) {
        lastError = new Error(`${host}: ${error.message}`);
      }
    }
    await sleep(400);
  }
  throw new Error(lastError ? `Edge remote debugging did not become ready: ${lastError.message}` : "Edge remote debugging target not found.");
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", (event) => reject(event.error || new Error("WebSocket connection failed.")), { once: true });
      this.ws.addEventListener("message", (event) => {
        const payload = JSON.parse(String(event.data));
        if (!payload.id) {
          return;
        }
        const deferred = this.pending.get(payload.id);
        if (!deferred) {
          return;
        }
        this.pending.delete(payload.id);
        if (payload.error) {
          deferred.reject(new Error(payload.error.message || JSON.stringify(payload.error)));
          return;
        }
        deferred.resolve(payload.result);
      });
      this.ws.addEventListener("close", () => {
        for (const deferred of this.pending.values()) {
          deferred.reject(new Error("CDP socket closed."));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

function buildMarkingExpression(numbers, ticketNo) {
  return `
(() => {
  const numbers = ${JSON.stringify(numbers)};
  const ticketNo = ${JSON.stringify(ticketNo)};
  const targetUrl = ${JSON.stringify(OFFICIAL_URL)};
  const contexts = [{ win: window, doc: document }];
  document.querySelectorAll("iframe, frame").forEach((frame) => {
    try {
      const frameWin = frame.contentWindow;
      const frameDoc = frameWin && frameWin.document;
      if (frameWin && frameDoc) {
        contexts.push({ win: frameWin, doc: frameDoc });
      }
    } catch (error) {
      // Ignore cross-origin frames while the official page finishes loading.
    }
  });
  const targetContext =
    contexts.find(({ doc }) => doc.getElementById("check645num1")) ||
    contexts.find(({ doc }) => doc.getElementById("num1")) ||
    contexts.find(({ doc }) => doc.querySelectorAll("[id^='check645num']").length >= 45 || doc.querySelectorAll("[id^='num']").length >= 45);
  if (!targetContext) {
    return {
      ok: false,
      retry: true,
      message: "?뺢퀡??????놁졑 ??⑤챶????リ옇??濡㏓뎨???繞벿살탳????덈펲.",
      url: window.location.href || targetUrl,
    };
  }

  const { win, doc } = targetContext;
  const $ = win.jQuery || window.jQuery || null;
  const clearSelectors = [
    "#btnReset",
    "#btnNumberReset",
    ".btn_reset",
    ".btn_reset_new",
    "button[onclick*='reset']",
    "a[onclick*='reset']",
    "input[onclick*='reset']"
  ];
  const clearButton = clearSelectors.map((selector) => doc.querySelector(selector)).find(Boolean);
  if (clearButton) {
    clearButton.click();
  }

  const missing = [];
  const usesCheckboxBoard = Boolean(doc.getElementById("check645num1"));
  if ($ && usesCheckboxBoard) {
    numbers.forEach((number) => {
      const $button = $(doc).find("#check645num" + number);
      if (!$button.length) {
        missing.push(number);
        return;
      }
      if (!$button.is(":checked")) {
        $button.trigger("click");
      }
    });
  } else {
    numbers.forEach((number) => {
      const button = doc.getElementById("check645num" + number) || doc.getElementById("num" + number);
      if (!button) {
        missing.push(number);
        return;
      }
      if (button.type === "checkbox" && button.checked) {
        return;
      }
      button.click();
    });
  }

  if (missing.length) {
    return {
      ok: false,
      retry: false,
      message: "?뺢퀡????뺢퀗????嶺뚢돦堉? 嶺뚮쪇沅?쭛???鍮?? " + missing.join(", "),
      url: win.location && win.location.href ? win.location.href : targetUrl,
    };
  }

  return {
    ok: true,
    retry: false,
    ticket_no: ticketNo,
    numbers,
    message: "Ticket " + ticketNo + " 嶺뚮씭?뉑쾮??熬곣뫁??,
    url: win.location && win.location.href ? win.location.href : targetUrl,
  };
})()
  `.trim();
}

async function markNumbers({ wsUrl, numbers, ticketNo, timeoutMs }) {
  const client = new CDPClient(wsUrl);
  await client.connect();

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.bringToFront");

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await client.send("Runtime.evaluate", {
        expression: buildMarkingExpression(numbers, ticketNo),
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
      }

      const payload = result.result?.value;
      if (!payload) {
        throw new Error("Runtime evaluation returned no payload.");
      }
      if (payload.ok) {
        return payload;
      }
      if (!payload.retry) {
        throw new Error(payload.message || "Official site marking failed.");
      }
      await sleep(500);
    }

    throw new Error("?뺢퀡??????놁졑 UI ?β돦裕녽???????蹂?뜟???貫????琉????鍮??");
  } finally {
    client.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = choosePort();

  await launchEdge({ port });
  const target = await waitForPageTarget({ port, timeoutMs: args.timeoutMs });
  const payload = await markNumbers({
    wsUrl: target.webSocketDebuggerUrl,
    numbers: args.numbers,
    ticketNo: args.ticketNo,
    timeoutMs: args.timeoutMs,
  });

  process.stdout.write(`${JSON.stringify({ ok: true, ...payload })}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
