/* =============================================================
 * labeltest.js — 验证新 8 节点体系的文本显示、双击编辑、形状尺寸
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
    roundRect: noop, rect: noop, clip: noop,
    measureText(t) { calls.measure[t] = calls.measure[t] || Math.ceil(String(t).length * 8); return { width: calls.measure[t] }; }
  };
  return new Proxy(base, { get(t, p) { return p in t ? t[p] : noop; } });
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
  prompt: () => "_PROMPT_ANSWER_",
  Image: function () { return { src: "" }; }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("lib/litegraph.js", "utf8"), sandbox, { filename: "litegraph.js" });
vm.runInContext(fs.readFileSync("src/diagnosis-nodes.js", "utf8"), sandbox, { filename: "diagnosis-nodes.js" });

const { LiteGraph } = sandbox;

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { console.log("  PASS  " + label); passed++; }
  else { console.log("  FAIL  " + label + (detail ? "  — " + detail : "")); failed++; }
}

// ---- 8 种节点均已注册 ----
const TYPES = ["diagnosis/start", "diagnosis/diag", "diagnosis/action",
  "diagnosis/conclusion", "diagnosis/measure", "diagnosis/resolved",
  "diagnosis/escalate", "diagnosis/continue"];
check("DiagFlowNodes.types 含 8 种节点", sandbox.DiagFlowNodes.types.length === 8,
  "count=" + sandbox.DiagFlowNodes.types.length);
TYPES.forEach((t) => {
  check("节点已注册: " + t, typeof LiteGraph.registered_node_types[t] === "function");
});

// ---- 创建各节点 ----
const start = LiteGraph.createNode("diagnosis/start");
const diag = LiteGraph.createNode("diagnosis/diag");
const action = LiteGraph.createNode("diagnosis/action");
const conclusion = LiteGraph.createNode("diagnosis/conclusion");
const measure = LiteGraph.createNode("diagnosis/measure");
const resolved = LiteGraph.createNode("diagnosis/resolved");
const escalate = LiteGraph.createNode("diagnosis/escalate");
const cont = LiteGraph.createNode("diagnosis/continue");

// ---- 每节点 4 输入 + 4 输出，无标题栏，尺寸固定 ----
TYPES.forEach((t) => {
  const n = LiteGraph.createNode(t);
  check(t + " 4输入+4输出", n.inputs.length === 4 && n.outputs.length === 4);
  check(t + " 无标题栏", n.constructor.title_mode === sandbox.LiteGraph.NO_TITLE);
  check(t + " 尺寸固定", n.resizable === false);
});

// ---- getLabel 存在 ----
check("诊断节点有 getLabel", typeof diag.getLabel === "function");
check("诊断动作有 getLabel", typeof action.getLabel === "function");
check("继续活动有 getLabel（固定文本）", typeof cont.getLabel === "function");

// ---- 文本字段默认值 ----
check("诊断节点默认文本字段 data", typeof diag.properties.data === "string" && diag.properties.data.length > 0);
check("诊断动作主字段 action + 副字段 followup",
  typeof action.properties.action === "string" && typeof action.properties.followup === "string");
check("结论默认文本字段 conclusion", typeof conclusion.properties.conclusion === "string");
check("继续活动无文本字段（固定文本）", !cont.properties || Object.keys(cont.properties).length === 0,
  "props=" + JSON.stringify(cont.properties));

// ---- 尺寸 ----
check("起点尺寸 ≥ 150x70", start.size[0] >= 150 && start.size[1] >= 70,
  "w=" + start.size[0] + ",h=" + start.size[1]);
check("菱形结论尺寸 ≥ 160x110", conclusion.size[0] >= 160 && conclusion.size[1] >= 110,
  "w=" + conclusion.size[0] + ",h=" + conclusion.size[1]);

// ---- onDrawBackground 绘制文本 ----
const ctx = ctxProxy();
start.onDrawBackground(ctx, null);
check("起点绘制调用了 fillText", ctx._calls.fillText >= 1);

const aCtx = ctxProxy();
action.onDrawBackground(aCtx, null);
check("诊断动作绘制主+副文本（fillText ≥ 2）", aCtx._calls.fillText >= 2,
  "fillText=" + aCtx._calls.fillText);

const cCtx = ctxProxy();
cont.onDrawBackground(cCtx, null);
check("继续活动绘制固定文本", cCtx._calls.fillText >= 1);

// ---- 双击编辑：onDblClick 触发就地文本框（不再用 prompt）----
// 新行为：onDblClick 调用 DiagFlowUI.startTextEdit(node)，由 app.js 提供就地编辑。
// 这里 mock startTextEdit 捕获调用，验证 onDblClick 正确委托。
let startEditCalls = [];
sandbox.DiagFlowUI = {
  startTextEdit: (node) => { startEditCalls.push(node); }
};

diag.onDblClick();
check("诊断节点双击委托 startTextEdit", startEditCalls.length === 1 && startEditCalls[0] === diag,
  "calls=" + startEditCalls.length);

startEditCalls = [];
action.onDblClick();
check("诊断动作双击委托 startTextEdit", startEditCalls.length === 1 && startEditCalls[0] === action);

// 继续活动固定文本节点：onDblClick 应 no-op（不委托、不报错）
startEditCalls = [];
let threw = null;
try { cont.onDblClick(); } catch (e) { threw = e; }
check("继续活动 onDblClick 不报错", !threw, threw && threw.message);
check("继续活动 onDblClick 不委托 startTextEdit（固定文本）", startEditCalls.length === 0);

// 无 DiagFlowUI 时 onDblClick 不报错（降级静默）
sandbox.DiagFlowUI = undefined;
let threw2 = null;
try { diag.onDblClick(); } catch (e) { threw2 = e; }
check("无 DiagFlowUI 时 onDblClick 不报错", !threw2, threw2 && threw2.message);

// ---- 形状路径类型 ----
check("shapePath 支持 8 种类型（不抛错）", (() => {
  try {
    TYPES.forEach((t) => {
      const c2 = ctxProxy();
      sandbox.DiagFlowNodes.shapePath(c2, t, 0, 0, 180, 100);
    });
    return true;
  } catch (e) { return false; }
})());

console.log("\n" + passed + " / " + (passed + failed) + " 通过");
process.exit(failed === 0 ? 0 : 1);
