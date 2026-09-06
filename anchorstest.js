/* 无头测试：四向通用锚点 + 行为决定方向 + 约束气泡 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const DIR = __dirname;
let NOW = 10000;

/* ---------------- mock DOM / Canvas ---------------- */
function makeCtx() {
  const calls = { opCount: 0 };
  const target = {
    fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1,
    shadowBlur: 0, shadowColor: "", shadowOffsetX: 0, shadowOffsetY: 0,
    font: "", textAlign: "", lineDashOffset: 0,
    measureText: () => ({ width: 10 }),
    canvas: { width: 900, height: 600 }
  };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      const fn = (...a) => { calls.opCount++; };
      t[p] = fn;
      return fn;
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

function makeEl(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    localName: tag || "div",
    style: { setProperty() {} },
    dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    className: "", id: "", textContent: "", value: "", innerHTML: "",
    width: 900, height: 600, clientWidth: 900, clientHeight: 600,
    offsetWidth: 100, offsetHeight: 30,
    children: [], parentNode: null, ownerDocument: null, nodeName: "DIV",
    _ctx: null,
    getContext() { if (!this._ctx) this._ctx = makeCtx(); return this._ctx; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
    addEventListener() {}, removeEventListener() {},
    focus() {}, blur() {}, click() {}, setAttribute() {}, getAttribute: () => null,
    querySelector: () => makeEl(), querySelectorAll: () => [],
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; return c; },
    contains: (n) => n === el || el.children.includes(n)
  };
  return el;
}

const captured = {};
const ids = {};
const bodyChildren = [];
["graph-canvas", "status", "btn-sample", "btn-stress", "btn-clear", "btn-validate", "btn-infer", "btn-export", "btn-import"]
  .forEach((id) => { ids[id] = makeEl(id === "graph-canvas" ? "canvas" : "button"); });

const sandbox = {
  console,
  performance: { now: () => NOW },
  requestAnimationFrame: () => 0,
  setTimeout: () => 0, clearTimeout: () => {},
  alert: () => {}, confirm: () => true, prompt: () => null,
  Image: function () { return { src: "", onload: null }; },
  document: {
    activeElement: null,
    getElementById: (id) => ids[id] || null,
    querySelector: (sel) => {
      if (sel === ".canvas-wrap") return { clientWidth: 900, clientHeight: 600 };
      if (sel === "#graph-canvas") return ids["graph-canvas"];
      return makeEl("div");
    },
    querySelectorAll: () => [],
    createElement: (t) => makeEl(t),
    addEventListener() {}, removeEventListener() {},
    body: {
      style: { setProperty() {}, overflow: "" },
      appendChild(c) { if (c.id) ids[c.id] = c; bodyChildren.push(c); return c; },
      children: bodyChildren
    }
  },
  navigator: { userAgent: "node" }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.document.defaultView = sandbox;
ids["graph-canvas"].ownerDocument = sandbox.document;
const canvasParent = makeEl("div");
canvasParent.offsetWidth = 900; canvasParent.offsetHeight = 600;
ids["graph-canvas"].parentNode = canvasParent;

vm.createContext(sandbox);
for (const f of ["lib/litegraph.js", "src/diagnosis-nodes.js"]) {
  vm.runInContext(fs.readFileSync(path.join(DIR, f), "utf8"), sandbox, { filename: f });
}

// SpyCanvas：捕获 app.js 闭包里创建的 canvas 实例
const RealCanvas = sandbox.LGraphCanvas;
sandbox.LGraphCanvas = new Proxy(RealCanvas, {
  construct(t, args) {
    const c = new t(...args);
    captured.canvas = c;
    return c;
  }
});

vm.runInContext(fs.readFileSync(path.join(DIR, "src/app.js"), "utf8"), sandbox, { filename: "app.js" });

const { LiteGraph } = sandbox;
const canvas = captured.canvas;
const graph = canvas.graph;

/* ---------------- helpers ---------------- */
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  [" + extra + "]" : "")); }
}
function ev(x, y) {
  return { clientX: x, clientY: y, canvasX: x, canvasY: y, which: 1, button: 0,
    preventDefault() {}, stopPropagation() {} };
}
function press(x, y) { canvas._mousedown_callback(ev(x, y)); }
function release(x, y) { canvas._mouseup_callback(ev(x, y)); }
function drag(from, to) { press(from[0], from[1]); release(to[0], to[1]); }
function anchor(node, idx) {
  const p = node.getConnectionPos(false, idx);
  return [p[0], p[1]];
}
function mkNode(type, x, y) {
  const n = LiteGraph.createNode(type);
  n.pos = [x, y];
  graph.add(n);
  return n;
}
// visible_nodes 由渲染帧更新；无头环境无渲染帧，手动同步
function syncVisible() { canvas.visible_nodes = graph._nodes; }
function linkCount() { return Object.keys(graph.links).length; }
function toastCount() { return (ids["toast-host"] ? ids["toast-host"].children : []).length; }
function lastToastText() {
  const host = ids["toast-host"];
  if (!host || !host.children.length) return "";
  const t = host.children[host.children.length - 1];
  const textEl = t.children.filter((c) => c.className === "toast-text")[0];
  return textEl ? textEl.textContent : "";
}
function linksBetween(a, b) {
  return Object.values(graph.links).filter((l) => l && l.origin_id === a.id && l.target_id === b.id).length;
}

console.log("== 1. 启动无回归（示例图 + 新节点模型） ==");
check("示例图 8 节点 / 7 连线", graph._nodes.length === 8 && linkCount() === 7,
  graph._nodes.length + "节点/" + linkCount() + "连线");
check("启动过程无报错气泡（约束全部合法）", toastCount() === 0);
const anyNode = graph._nodes[0];
check("每个节点 4 输入 + 4 输出", graph._nodes.every((n) => n.inputs.length === 4 && n.outputs.length === 4));
check("无标题栏（title_mode = NO_TITLE）", anyNode.constructor.title_mode === sandbox.LiteGraph.NO_TITLE);
check("库默认底色已透明（由自绘接管）", anyNode.constructor.bgcolor === "rgba(0,0,0,0)");
check("尺寸固定（resizable = false）", graph._nodes.every((n) => n.resizable === false));

console.log("== 2. 锚点几何（上下左右边中点） ==");
const s0 = graph.findNodesByType("diagnosis/start")[0];
const ap = anchor(s0, 0), ar = anchor(s0, 1), ab = anchor(s0, 2), al = anchor(s0, 3);
// 节点尺寸动态读（节点尺寸可能在版本演进中调整）
const w0 = s0.size[0], h0 = s0.size[1];
check("上锚点 = 顶边中点", Math.abs(ap[0] - (s0.pos[0] + w0 * 0.5)) < 0.01 && Math.abs(ap[1] - s0.pos[1]) < 0.01);
check("右锚点 = 右边中点", Math.abs(ar[0] - (s0.pos[0] + w0)) < 0.01 && Math.abs(ar[1] - (s0.pos[1] + h0 * 0.5)) < 0.01);
check("下锚点 = 底边中点", Math.abs(ab[0] - (s0.pos[0] + w0 * 0.5)) < 0.01 && Math.abs(ab[1] - (s0.pos[1] + h0)) < 0.01);
check("左锚点 = 左边中点", Math.abs(al[0] - s0.pos[0]) < 0.01);

console.log("== 3. 行为决定方向（真实 mousedown/mouseup 路径） ==");
graph.clear();
const A = mkNode("diagnosis/start", 100, 100);
const B = mkNode("diagnosis/question", 400, 100);
const C = mkNode("diagnosis/question", 700, 100);
syncVisible(); // visible_nodes 由渲染帧更新，无头环境手动同步

drag(anchor(A, 1), anchor(B, 3)); // A 右锚 → B 左锚
check("从 A 拖到 B：A 为输出、B 为输入", linksBetween(A, B) === 1, "links=" + linksBetween(A, B));
const l1 = Object.values(graph.links).find((l) => l && l.origin_id === A.id);
check("槽位：origin_slot=右(1)，target_slot=左(3)", l1 && l1.origin_slot === 1 && l1.target_slot === 3);

drag(anchor(B, 1), anchor(C, 3)); // B 右锚 → C 左锚
check("B → C 连线成功", linksBetween(B, C) === 1);

drag(anchor(C, 0), anchor(A, 2)); // 反向场景：从 C 上锚拖到 A 下锚（A 是 start，应拒绝）
check("起点不能被连入（拒绝且无连线）", linksBetween(C, A) === 0 && linkCount() === 2);
check("弹出拒绝气泡", toastCount() >= 1 && lastToastText().indexOf("诊断起点") !== -1, lastToastText());

console.log("== 4. 约束与气泡 ==");
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"]; // 清空气泡
const Q1 = mkNode("diagnosis/question", 100, 100);
const Q2 = mkNode("diagnosis/question", 400, 100);
const Q3 = mkNode("diagnosis/question", 700, 100);
const LF = mkNode("diagnosis/leaf", 400, 300);
syncVisible();
drag(anchor(Q1, 1), anchor(Q2, 3));
drag(anchor(Q2, 1), anchor(Q3, 3));
check("Q1→Q2→Q3 建链成功", linksBetween(Q1, Q2) === 1 && linksBetween(Q2, Q3) === 1);

const before = toastCount();
drag(anchor(Q3, 1), anchor(Q2, 0)); // Q2 已有父节点
check("单父约束：第二次上游被拒绝", linksBetween(Q3, Q2) === 0 && linkCount() === 2);
check("单父气泡文案", toastCount() === before + 1 && lastToastText().indexOf("父节点") !== -1, lastToastText());

drag(anchor(LF, 1), anchor(Q3, 3)); // 结论作为来源（校验顺序：来源叶子判定先于单父判定）
check("结论作为来源被拒绝", linksBetween(LF, Q3) === 0);
check("结论气泡文案", lastToastText().indexOf("诊断结论") !== -1, lastToastText());

console.log("== 5. 只允许锚点对锚点 ==");
const beforeLinks = linkCount();
const beforeToasts = toastCount();
drag(anchor(Q1, 1), [Q3.pos[0] + 70, Q3.pos[1] + 55]); // 释放点在 Q3 主体中部（非锚点）
check("拖到节点主体不自动连线（connectByType 已禁用）",
  linkCount() === beforeLinks && toastCount() === beforeToasts);

press(anchor(Q2, 1)); release(anchor(Q2, 1)); // 原地松手
check("锚点原地松手：不连线、不弹气泡", linkCount() === beforeLinks && toastCount() === beforeToasts);

console.log("== 6. 槽位隐藏包装与形状绘制 ==");
const ctx = canvas.canvas.getContext();
let threw = null;
try { canvas.drawNode(Q1, ctx); } catch (e) { threw = e; }
check("drawNode（隐藏默认槽位）不抛错", !threw, threw && threw.message);
check("绘制后 inputs/outputs 已恢复（4+4）", Q1.inputs.length === 4 && Q1.outputs.length === 4);

console.log("== 7. 气泡组件本身 ==");
sandbox.window.DiagFlowUI.toast("测试信息", "info");
check("toast 入驻右下角容器", toastCount() >= 1);
const tEl = ids["toast-host"].children[ids["toast-host"].children.length - 1];
check("气泡带类型 accent 与显示类",
  tEl.className.indexOf("toast-info") !== -1 && tEl.classList.contains("toast-show"));

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
