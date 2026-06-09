#!/usr/bin/env node

import fs from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";

const LOGIN_URL = "https://www.dhlottery.co.kr/login";
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
  const parsed = { timeoutMs: 45000 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--timeout-ms") {
      parsed.timeoutMs = Number(argv[index + 1] || "45000");
      index += 1;
    }
  }
  return parsed;
}

function readStdinJson() {
  const raw = fs.readFileSync(0, "utf8").replace(/^\uFEFF/, "");
  const payload = JSON.parse(raw || "{}");
  const userId = String(payload.user_id || "").trim();
  const password = String(payload.password || "");
  if (!userId || !password) {
    throw new Error("아이디와 비밀번호가 필요합니다.");
  }
  return { userId, password };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function choosePort() {
  return 9322 + Math.floor(Math.random() * 400);
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
    return resolvConf
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("nameserver "))
      .map((line) => line.split(/\s+/)[1])
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildDebugHosts() {
  const envHosts = String(process.env.OFFICIAL_LOGIN_DEBUG_HOSTS || "")
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

async function launchBrowser({ port }) {
  const profileName = `lottobang-login-${port}`;
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
      LOGIN_URL,
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
          return url.includes("/login") || url.includes("user.do");
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
  throw new Error(lastError ? `Browser remote debugging did not become ready: ${lastError.message}` : "Browser target not found.");
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
        if (!payload.id) return;
        const deferred = this.pending.get(payload.id);
        if (!deferred) return;
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

async function waitForPageReady(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await client.send("Runtime.evaluate", {
        expression: `
(() => {
const frames = Array.from(document.querySelectorAll("iframe, frame")).map((frame) => frame.src || frame.getAttribute("src") || "");
return ({
  href: location.href,
  readyState: document.readyState,
  hasLoginWrap: Boolean(document.querySelector(".login-wrap")),
  hasUserId: Boolean(document.querySelector("#inpUserId")),
  hasPassword: Boolean(document.querySelector("#inpUserPswdEncn")),
  frames
});
})()
`.trim(),
        returnByValue: true,
      });
      const payload = result.result?.value;
      if (payload?.readyState === "complete" && (payload.hasLoginWrap || (payload.hasUserId && payload.hasPassword))) {
        return payload;
      }
    } catch {
      // The page can be between redirects; retry until the login DOM stabilizes.
    }
    await sleep(500);
  }
  throw new Error("동행복권 로그인 페이지 로딩이 제한 시간 안에 완료되지 않았습니다.");
}

function buildFillExpression({ userId, password }) {
  return `
(async () => {
  const userId = ${JSON.stringify(userId)};
  const password = ${JSON.stringify(password)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const byXPath = (xpath) => document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  const setValue = (element, value) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const visible = (element) => {
    if (!element || element.type === "hidden" || element.hidden) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const findOne = (selectors) => selectors
    .map((selector) => document.querySelector(selector))
    .find((element) => element && visible(element));
  const idInput = byXPath('//*[@id="inpUserId"]') || byXPath("//input[@id='inpUserId']") || findOne([
    "#inpUserId",
    "#txtUserId",
    "input[name='inpUserId']",
    "input[name='userid']",
    "input[name='loginId']",
    "input.login-id",
    "input[type='text']:not([type='hidden'])"
  ]);
  const passwordInput = byXPath('//*[@id="inpUserPswdEncn"]') || byXPath("//input[@id='inpUserPswdEncn']") || findOne([
    "#inpUserPswdEncn",
    "#password",
    "#userPwd",
    "#txtPassword",
    "input[name='inpUserPswdEncn']",
    "input[name='password']",
    "input[name='passwd']",
    "input[name='pwd']",
    "input.login-pw",
    "input[type='password']"
  ]);
  const loginButton = byXPath('//*[@id="btnLogin"]') || byXPath("//button[@id='btnLogin']") || findOne([
    "#btnLogin",
    "button.login-btn",
    "button[type='button']"
  ]);
  if (!idInput || !passwordInput) {
    return {
      ok: false,
      retry: true,
      message: "동행복권 로그인 입력칸을 찾지 못했습니다.",
      url: location.href,
      diagnostics: {
        readyState: document.readyState,
        hasLoginWrap: Boolean(document.querySelector(".login-wrap")),
        hasInpUserId: Boolean(document.querySelector("#inpUserId")),
        hasInpUserPswdEncn: Boolean(document.querySelector("#inpUserPswdEncn")),
        inputIds: Array.from(document.querySelectorAll("input")).map((input) => ({
          id: input.id,
          name: input.name,
          type: input.type,
          visible: visible(input)
        })).slice(0, 20)
      }
    };
  }
  idInput.removeAttribute("readonly");
  passwordInput.removeAttribute("readonly");
  idInput.focus();
  await sleep(250);
  setValue(idInput, userId);
  idInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
  setValue(passwordInput, password);
  idInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  passwordInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  passwordInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
  passwordInput.focus();
  await sleep(900);
  if (!loginButton || !visible(loginButton)) {
    return {
      ok: false,
      retry: false,
      message: "동행복권 로그인 버튼을 찾지 못했습니다.",
      url: location.href
    };
  }
  loginButton.click();
  return {
    ok: true,
    retry: false,
    message: "동행복권 로그인 입력 후 로그인 버튼을 클릭했습니다.",
    url: location.href,
    diagnostics: {
      idSelector: idInput.id || idInput.name || idInput.className || idInput.tagName,
      passwordSelector: passwordInput.id || passwordInput.name || passwordInput.className || passwordInput.tagName,
      loginButton: loginButton.id || loginButton.className || loginButton.tagName,
      userIdLength: idInput.value.length,
      passwordLength: passwordInput.value.length
    }
  };
})()
`.trim();
}

async function fillLoginFields({ wsUrl, userId, password, timeoutMs }) {
  const client = new CDPClient(wsUrl);
  await client.connect();
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.bringToFront");
    await waitForPageReady(client, Math.min(timeoutMs, 20000));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await client.send("Runtime.evaluate", {
        expression: buildFillExpression({ userId, password }),
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
      }
      const payload = result.result?.value;
      if (payload?.ok) return payload;
      if (payload && !payload.retry) throw new Error(payload.message || "Official login fill failed.");
      await sleep(500);
    }
    throw new Error("동행복권 로그인 입력칸이 제한 시간 안에 준비되지 않았습니다.");
  } finally {
    client.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const credentials = readStdinJson();
  const port = choosePort();
  await launchBrowser({ port });
  const target = await waitForPageTarget({ port, timeoutMs: args.timeoutMs });
  const payload = await fillLoginFields({
    wsUrl: target.webSocketDebuggerUrl,
    userId: credentials.userId,
    password: credentials.password,
    timeoutMs: args.timeoutMs,
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...payload })}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
