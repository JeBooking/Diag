/* =============================================================
 * labeltest.js — 验证节点内文本显示与双击编辑
 * ============================================================= */
"use strict";
const fs = require("fs");
const vm = require("vm");

// ---- DOM mock ----
function makeEl(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    localName: (tag || "div"),
    id: "",
    style: {},
    className: "",
    innerHTML: "",
    textContent: "",
    value: "",
    dataset: {},
    children: [],
    attributes: {},
    parentNode: null,
    ownerDocument: null,
    clientWidth: 900, clientHeight: 600,
    offsetWidth: 900, offsetHeight: 600,
    getContext() { return ctxProxy(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {},
    setAttribute(k, v) { el.attributes[k] = v; },
    getAttribute(k) { return el.attributes[k] || null; },
    removeAttribute(k) { delete el.attributes[k]; },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { c.parentNode = null; const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; }
  };
  return el;
}

function ctxProxy() {
  const calls = { opCount: 0, fillText: 0, fill: 0, stroke: 0, beginPath: 0, measure: {} };
  const noop = () => { calls.opCount++; };
  const noopWithLabel = (label) => () => { calls.opCount++; calls[label] = (calls[label] || 0) + 1; };
  const base = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, shadowBlur: 0, shadowColor: "",
    globalAlpha: 1, font: "", textAlign: "", textBaseline: "",
    canvas: { width: 900, height: 600 },
    _calls: calls,
    fill: noopWithLabel("fill"), stroke: noopWithLabel("stroke"),
    beginPath: noopWithLabel("beginPath"), closePath: noop,
    moveTo: noop, lineTo: noop, arc: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop, fillText: noopWithLabel("fillText"),
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop, setLineDash: noop,
    roundRect: noop,
    rect: noop, clip: noop,
    measureText(t) { calls.measure[t] = calls.measure[t] || Math.ceil(String(t).length * 8); return { width: calls.measure[t] }; }
  };
  return new Proxy(base, {
    get(t, p) { return p in t ? t[p] : noop; }
  });
}

const ids = {};
const bodyChildren = [];
const documentMock = {
  createElement: (t) => makeEl(t),
  addEventListener() {}, removeEventListener() {},
  body: { appendChild(c) { if (c.id) ids[c.id] = c; bodyChildren.push(c); return c; }, children: bodyChildren }
};

const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame(cb) { return setTimeout(cb, 16); },
  performance: { now: () => Date.now() },
  document: documentMock,
  window: null,
  alert: () => {}, confirm: () => true,
  prompt: () => "_PROMPT_ANSWER_",   // 测试用：所有 prompt 返回固定答案
  Image: function () { return { src: "" }; }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

// 加载库 + 节点（必须先 createContext 再 runInContext）
vm.createContext(sandbox);
const litegraphSrc = fs.readFileSync("lib/litegraph.js", "utf8");
vm.runInContext(litegraphSrc, sandbox, { filename: "litegraph.js" });

const diagSrc = fs.readFileSync("src/diagnosis-nodes.js", "utf8");
vm.runInContext(diagSrc, sandbox, { filename: "diagnosis-nodes.js" });

const { LiteGraph } = sandbox;

// 工具
let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { console.log("  PASS  " + label); passed++; }
  else { console.log("  FAIL  " + label + (detail ? "  — " + detail : "")); failed++; }
}

// ---- 创建节点 ----
const start = LiteGraph.createNode("diagnosis/start");
const q = LiteGraph.createNode("diagnosis/question");
const leaf = LiteGraph.createNode("diagnosis/leaf");

// ---- getLabel 函数存在 ----
check("起点有 getLabel", typeof start.getLabel === "function");
check("问诊有 getLabel", typeof q.getLabel === "function");
check("结论有 getLabel", typeof leaf.getLabel === "function");

// ---- onDblClick 函数存在 ----
check("起点有 onDblClick", typeof start.onDblClick === "function");
check("问诊有 onDblClick", typeof q.onDblClick === "function");
check("结论有 onDblClick", typeof leaf.onDblClick === "function");

// ---- 节点尺寸足够容纳文本 ----
check("起点高度 ≥ 70", start.size[1] >= 70, "h=" + start.size[1]);
check("起点宽度 ≥ 150", start.size[0] >= 150, "w=" + start.size[0]);
check("问诊高度 ≥ 110", q.size[1] >= 110, "h=" + q.size[1]);
check("问诊宽度 ≥ 160", q.size[0] >= 160, "w=" + q.size[0]);
check("结论高度 ≥ 80", leaf.size[1] >= 80, "h=" + leaf.size[1]);
check("结论宽度 ≥ 160", leaf.size[0] >= 160, "w=" + leaf.size[0]);

// ---- onDrawBackground 调用流程：绘制形状 → 文本 → 锚点 ----
const ctx = ctxProxy();
start.onDrawBackground(ctx, null);
check("起点绘制时调用了 fillText", ctx._calls.fillText >= 1);
const qCtx = ctxProxy();
q.onDrawBackground(qCtx, null);
check("问诊绘制时调用了 fillText", qCtx._calls.fillText >= 1);
const lCtx = ctxProxy();
leaf.onDrawBackground(lCtx, null);
check("结论绘制时调用了 fillText（主+副标题至少 2 次）", lCtx._calls.fillText >= 2, "fillText=" + lCtx._calls.fillText);

// ---- wrapText 行为：通过绘制结果验证（最长 4 行 + 省略号）----
const longQ = LiteGraph.createNode("diagnosis/question");
longQ.properties.question = "这是一个非常长的测试问题用来验证自动换行是否生效并截断到四行——再多内容也应该被省略";
const longCtx = ctxProxy();
longQ.onDrawBackground(longCtx, null);
check("超长问诊文本最多渲染 4 行（fillText 次数 == 4）", longCtx._calls.fillText === 4,
  "fillText=" + longCtx._calls.fillText + "（应为 4）");

// ---- 短文本单行 ----
const shortQ = LiteGraph.createNode("diagnosis/question");
shortQ.properties.question = "是否启动？";
const shortCtx = ctxProxy();
shortQ.onDrawBackground(shortCtx, null);
check("短文本只渲染 1 行", shortCtx._calls.fillText === 1, "fillText=" + shortCtx._calls.fillText);

// ---- 双击编辑：prompt 接受 null 返回值时不应改变属性 ----
const qBefore = q.properties.question;
q.onDblClick();
// prompt 默认返回 "_PROMPT_ANSWER_"
check("双击编辑后属性已被更新", q.properties.question === "_PROMPT_ANSWER_",
  "got " + q.properties.question);

// ---- 双击编辑：起点 ----
const startBefore = start.properties.scenario;
start.onDblClick();
check("起点双击编辑后属性已更新", start.properties.scenario === "_PROMPT_ANSWER_",
  "got " + start.properties.scenario);

// ---- 双击编辑：结论（编辑 name + confidence） ----
const leafBefore = leaf.properties.name;
leaf.onDblClick();
// prompt 两次都返回 "_PROMPT_ANSWER_"，parseFloat 拿到 NaN 不会改 confidence
check("结论双击编辑后 name 已更新", leaf.properties.name === "_PROMPT_ANSWER_",
  "got " + leaf.properties.name);
// confidence 应保持原值（prompt 返回非数字时不变）
check("结论双击编辑后 confidence 保持有效值",
  typeof leaf.properties.confidence === "number" && !isNaN(leaf.properties.confidence),
  "confidence=" + leaf.properties.confidence);

// ---- 文本字段保留示例里的 properties ----
const sampleStart = LiteGraph.createNode("diagnosis/start");
sampleStart.properties.scenario = "打印机无法开机诊断";
const sCtx = ctxProxy();
sampleStart.onDrawBackground(sCtx, null);
check("示例场景文本至少 1 行 fillText", sCtx._calls.fillText >= 1);

console.log("\n" + passed + " / " + (passed + failed) + " 通过");
process.exit(failed === 0 ? 0 : 1);
