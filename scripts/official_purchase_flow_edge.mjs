#!/usr/bin/env node

import fs from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";

const LOGIN_URL = "https://www.dhlottery.co.kr/login";
const MARKING_URL = "https://ol.dhlottery.co.kr/olotto/game/game645.do";
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
  const parsed = { timeoutMs: 90000 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--timeout-ms") {
      parsed.timeoutMs = Number(argv[index + 1] || "90000");
      index += 1;
    }
  }
  return parsed;
}

function readStdinJson() {
  const payload = JSON.parse(fs.readFileSync(0, "utf8").replace(/^\uFEFF/, "") || "{}");
  const userId = String(payload.user_id || "").trim();
  const password = String(payload.password || "");
  const tickets = Array.isArray(payload.tickets) ? payload.tickets : [];
  if (!userId || !password || !tickets.length) {
    throw new Error("아이디, 비밀번호, 추천번호 5세트가 필요합니다.");
  }
  return { userId, password, tickets };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function choosePort() {
  return 9622 + Math.floor(Math.random() * 400);
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildDebugHosts() {
  return unique(["127.0.0.1", "localhost"]);
}

function rewriteWebSocketHost(wsUrl, host) {
  const parsed = new URL(wsUrl);
  parsed.hostname = host;
  return parsed.toString();
}

async function launchBrowser({ port }) {
  const browser = chooseBrowser();
  const profile = fs.mkdtempSync(`${process.env.TEMP || process.env.TMP || "."}\\lottobang-flow-${port}-`);
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
  let lastError = null;
  while (Date.now() < deadline) {
    for (const host of buildDebugHosts()) {
      try {
        const response = await fetch(`http://${host}:${port}/json/list`);
        if (!response.ok) throw new Error(`CDP list request failed with ${response.status}`);
        const targets = await response.json();
        const pages = targets.filter((target) => target.type === "page");
        const target = pages.find((page) => String(page.url || "").includes("dhlottery")) || pages.at(-1);
        if (target?.webSocketDebuggerUrl) {
          return {
            ...target,
            webSocketDebuggerUrl: rewriteWebSocketHost(target.webSocketDebuggerUrl, host),
          };
        }
      } catch (error) {
        lastError = error;
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime evaluation failed.");
  }
  return result.result?.value;
}

function loginExpression({ userId, password }) {
  return `
(async () => {
  const userId = ${JSON.stringify(userId)};
  const password = ${JSON.stringify(password)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const byXPath = (xpath) => document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  const setValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  };
  const idInput = byXPath('//*[@id="inpUserId"]');
  const passwordInput = byXPath('//*[@id="inpUserPswdEncn"]');
  const loginButton = byXPath('//*[@id="btnLogin"]');
  if (!idInput || !passwordInput || !loginButton) {
    return { ok: false, retry: true, message: "로그인 입력칸 또는 로그인 버튼을 찾지 못했습니다.", url: location.href };
  }
  idInput.removeAttribute("readonly");
  passwordInput.removeAttribute("readonly");
  idInput.focus();
  setValue(idInput, userId);
  await sleep(250);
  setValue(passwordInput, password);
  await sleep(900);
  loginButton.click();
  return { ok: true, retry: false, message: "로그인 버튼을 클릭했습니다.", url: location.href };
})()
`.trim();
}

function clickPurchaseTabExpression() {
  return `
(() => {
  const byXPath = (xpath) => document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  const button = byXPath('//*[@id="btnMoLtgmPrchs"]') || document.querySelector("#btnMoLtgmPrchs");
  if (button) {
    button.scrollIntoView({ block: "center", inline: "center" });
    button.click();
    return { ok: true, clicked: true, url: location.href };
  }
  return { ok: false, retry: true, message: "btnMoLtgmPrchs 구매 버튼을 아직 찾지 못했습니다.", url: location.href };
})()
`.trim();
}

function directMarkingNavigationExpression(reason) {
  return `
(() => {
  const target = ${JSON.stringify(MARKING_URL)};
  location.assign(target);
  return { ok: true, fallback: true, reason: ${JSON.stringify(reason)}, target, from: location.href };
})()
`.trim();
}

function ensureMarkingPageExpression() {
  return `
(() => {
  const href = location.href;
  const isMarkingPage = /olotto\\/game\\/game645\\.do|\\/game\\/TotalGame\\.jsp/i.test(href);
  if (isMarkingPage) {
    return { ok: true, navigated: false, url: href };
  }
  location.assign(${JSON.stringify(MARKING_URL)});
  return { ok: true, navigated: true, from: href, target: ${JSON.stringify(MARKING_URL)} };
})()
`.trim();
}

function markingExpression(tickets) {
  return `
(async () => {
  const tickets = ${JSON.stringify(tickets)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const doc = document;
  const $ = window.jQuery || null;
  const trigger = (element) => { if (!element) return false; if ($) $(element).trigger("click"); else element.click(); return true; };
  const visible = (element) => {
    if (!element || element.hidden) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const textOf = (element) => (element.innerText || element.textContent || element.value || element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim();
  const attrsOf = (element) => [element.id, element.name, element.className, element.getAttribute("for"), element.getAttribute("value"), element.getAttribute("title"), element.getAttribute("onclick"), element.getAttribute("aria-label")].filter(Boolean).join(" ");
  const findNumber = (number) => {
    const text = String(number);
    const padded = text.padStart(2, "0");
    for (const id of ["check645num" + number, "num" + number, "lotto645num" + number, "lottoNum" + number]) {
      const byId = doc.getElementById(id);
      if (byId) return byId;
      const byFor = doc.querySelector("label[for='" + id + "']");
      if (byFor) return byFor;
    }
    const candidates = Array.from(doc.querySelectorAll("label, button, a, span, li, input[type='button']"))
      .filter(visible)
      .map((element) => {
        let score = 0;
        const label = textOf(element);
        const attrs = attrsOf(element);
        if (label === text || label === padded) score += 100;
        if (attrs.includes("645") || /num|number|ball|lotto/i.test(attrs)) score += 20;
        if (element.tagName.toLowerCase() === "label") score += 15;
        return { element, score };
      })
      .filter((candidate) => candidate.score >= 100)
      .sort((left, right) => right.score - left.score);
    return candidates[0]?.element || null;
  };
  if (!findNumber(1)) {
    return { ok: false, retry: true, message: "번호 선택판을 찾지 못했습니다.", url: location.href };
  }
  const clearBoard = () => {
    const clearButton = ["#btnReset", "#btnNumberReset", ".btn_reset", ".btn_reset_new", "button[onclick*='reset']", "a[onclick*='reset']", "input[onclick*='reset']"]
      .map((selector) => doc.querySelector(selector))
      .find(Boolean);
    if (clearButton) trigger(clearButton);
  };
  const clickNumber = (number) => {
    const checkbox = doc.getElementById("check645num" + number);
    if (checkbox) { if (!checkbox.checked) trigger(checkbox); return true; }
    return trigger(findNumber(number));
  };
  const amountSelect = doc.getElementById("amoundApply") || doc.getElementById("amountApply");
  const confirmButton = doc.getElementById("btnSelectNum") || doc.querySelector("button[onclick*='SelectNum'], a[onclick*='SelectNum'], input[onclick*='SelectNum']");
  const setAmount = async (value) => {
    if (!amountSelect) return;
    amountSelect.value = String(value);
    amountSelect.dispatchEvent(new Event("change", { bubbles: true }));
    amountSelect.dispatchEvent(new Event("input", { bubbles: true }));
    if ($) $(amountSelect).val(String(value)).trigger("change");
    await sleep(180);
  };
  const lineKeys = ["A", "B", "C", "D", "E"];
  const findLineControl = (lineKey) => {
    const exact = new RegExp("^" + lineKey + "$", "i");
    const candidates = Array.from(doc.querySelectorAll("label,button,a,li,span,div,input[type='radio'],input[type='button']"))
      .filter(visible)
      .map((element) => {
        let score = 0;
        if (exact.test(textOf(element))) score += 120;
        if (exact.test((element.getAttribute("value") || "").trim())) score += 90;
        if (attrsOf(element).includes(lineKey)) score += 25;
        return { element, score };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);
    return candidates[0]?.element || null;
  };
  for (let index = 0; index < tickets.length; index += 1) {
    const ticket = tickets[index];
    await setAmount(1);
    if (tickets.length > 1) {
      const lineControl = findLineControl(lineKeys[index]);
      if (lineControl) { trigger(lineControl); await sleep(180); }
    }
    clearBoard();
    await sleep(120);
    const missing = ticket.filter((number) => !clickNumber(number));
    if (missing.length) return { ok: false, retry: false, message: "찾지 못한 번호 버튼: " + missing.join(", "), url: location.href };
    await sleep(180);
    if (tickets.length > 1 && confirmButton) { trigger(confirmButton); await sleep(260); }
  }
  if (tickets.length === 1 && confirmButton) trigger(confirmButton);
  return { ok: true, retry: false, message: "추천번호 5세트 마킹 완료. 구매 버튼은 직접 확인 후 누르세요.", url: location.href, tickets };
})()
`.trim();
}

async function waitForOk(client, expressionFactory, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastPayload = null;
  while (Date.now() < deadline) {
    const payload = await evaluate(client, typeof expressionFactory === "function" ? expressionFactory() : expressionFactory);
    lastPayload = payload;
    if (payload?.ok) return payload;
    if (payload && !payload.retry) throw new Error(payload.message || "Official flow failed.");
    await sleep(700);
  }
  throw new Error(lastPayload?.message || "공식 사이트 화면이 제한 시간 안에 준비되지 않았습니다.");
}

async function runFlow({ wsUrl, userId, password, tickets, timeoutMs }) {
  const client = new CDPClient(wsUrl);
  await client.connect();
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.bringToFront");
    await waitForOk(client, () => loginExpression({ userId, password }), Math.min(timeoutMs, 30000));
    await sleep(3500);
    try {
      await waitForOk(client, clickPurchaseTabExpression, Math.min(timeoutMs, 30000));
    } catch (error) {
      await evaluate(client, directMarkingNavigationExpression(error?.message || "btnMoLtgmPrchs button was not available."));
    }
    await sleep(2000);
    const navigation = await evaluate(client, ensureMarkingPageExpression());
    await sleep(navigation?.navigated ? 5000 : 2500);
    const marking = await waitForOk(client, () => markingExpression(tickets), Math.min(timeoutMs, 45000));
    return marking;
  } finally {
    client.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = readStdinJson();
  const port = choosePort();
  await launchBrowser({ port });
  const target = await waitForPageTarget({ port, timeoutMs: args.timeoutMs });
  const result = await runFlow({
    wsUrl: target.webSocketDebuggerUrl,
    userId: payload.userId,
    password: payload.password,
    tickets: payload.tickets,
    timeoutMs: args.timeoutMs,
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
