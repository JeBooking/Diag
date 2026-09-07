/* 无头测试：四向通用锚点 + 行为决定方向 + 新 8 节点连接约束 + 气泡 */
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
    focus() {}, blur() {}, click() {}, select() {}, setAttribute() {}, getAttribute: () => null,
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
      if (sel === ".canvas-wrap") {
        if (!ids["canvas-wrap"]) {
          var cw = makeEl("div");
          cw.clientWidth = 900; cw.clientHeight = 600;
          cw.offsetWidth = 900; cw.offsetHeight = 600;
          ids["canvas-wrap"] = cw;
        }
        return ids["canvas-wrap"];
      }
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
function evBtn(x, y, which, button) {
  return { clientX: x, clientY: y, canvasX: x, canvasY: y, which: which, button: button,
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

console.log("== 1. 启动无回归（示例图 + 新 8 节点模型） ==");
// 新示例：起点→诊断→动作→诊断→结论→措施→问题解决→(继续/上升)，共 9 节点 8 连线
check("示例图 9 节点 / 8 连线", graph._nodes.length === 9 && linkCount() === 8,
  graph._nodes.length + "节点/" + linkCount() + "连线");
check("启动过程无报错气泡（约束全部合法）", toastCount() === 0, "toast=" + toastCount());
check("每个节点 4 输入 + 4 输出", graph._nodes.every((n) => n.inputs.length === 4 && n.outputs.length === 4));
check("无标题栏（title_mode = NO_TITLE）", graph._nodes[0].constructor.title_mode === sandbox.LiteGraph.NO_TITLE);
check("尺寸固定（resizable = false）", graph._nodes.every((n) => n.resizable === false));

console.log("== 2. 锚点几何（上下左右边中点） ==");
const s0 = graph.findNodesByType("diagnosis/start")[0];
const ap = anchor(s0, 0), ar = anchor(s0, 1), ab = anchor(s0, 2), al = anchor(s0, 3);
const w0 = s0.size[0], h0 = s0.size[1];
check("上锚点 = 顶边中点", Math.abs(ap[0] - (s0.pos[0] + w0 * 0.5)) < 0.01 && Math.abs(ap[1] - s0.pos[1]) < 0.01);
check("右锚点 = 右边中点", Math.abs(ar[0] - (s0.pos[0] + w0)) < 0.01 && Math.abs(ar[1] - (s0.pos[1] + h0 * 0.5)) < 0.01);
check("下锚点 = 底边中点", Math.abs(ab[0] - (s0.pos[0] + w0 * 0.5)) < 0.01 && Math.abs(ab[1] - (s0.pos[1] + h0)) < 0.01);
check("左锚点 = 左边中点", Math.abs(al[0] - s0.pos[0]) < 0.01);

console.log("== 3. 行为决定方向（真实 mousedown/mouseup 路径） ==");
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];
const A = mkNode("diagnosis/start", 100, 100);
const D1 = mkNode("diagnosis/diag", 400, 100);
const D2 = mkNode("diagnosis/diag", 700, 100);
syncVisible();

drag(anchor(A, 1), anchor(D1, 3));
check("起点 → 诊断节点 连线成功", linksBetween(A, D1) === 1, "links=" + linksBetween(A, D1));
const l1 = Object.values(graph.links).find((l) => l && l.origin_id === A.id);
check("槽位：origin_slot=右(1)，target_slot=左(3)", l1 && l1.origin_slot === 1 && l1.target_slot === 3);

drag(anchor(D1, 1), anchor(D2, 3));
check("诊断 → 诊断 连线成功", linksBetween(D1, D2) === 1);

drag(anchor(D2, 0), anchor(A, 2)); // 反向：起点不能被连入
check("起点不能被连入（拒绝且无连线）", linksBetween(D2, A) === 0 && linkCount() === 2);
check("弹出拒绝气泡（含「诊断起点」）", toastCount() >= 1 && lastToastText().indexOf("诊断起点") !== -1, lastToastText());

console.log("== 4. 新 8 节点连接约束（严格拦截） ==");
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];

// 4.1 合法链路：start→diag→action→diag→conclusion→measure→resolved→continue/escalate
const st = mkNode("diagnosis/start", 100, 100);
const dg = mkNode("diagnosis/diag", 300, 100);
const ac = mkNode("diagnosis/action", 500, 100);
const cj = mkNode("diagnosis/conclusion", 700, 100);
const ms = mkNode("diagnosis/measure", 900, 100);
const rv = mkNode("diagnosis/resolved", 1100, 100);
const co = mkNode("diagnosis/continue", 1100, 250);
const es = mkNode("diagnosis/escalate", 1100, 400);
syncVisible();

drag(anchor(st, 1), anchor(dg, 3));
drag(anchor(dg, 1), anchor(ac, 3));
drag(anchor(ac, 1), anchor(cj, 3));
drag(anchor(cj, 1), anchor(ms, 3));
drag(anchor(ms, 1), anchor(rv, 3));
drag(anchor(rv, 1), anchor(co, 3));
drag(anchor(rv, 1), anchor(es, 3));
check("完整合法闭环建链成功（7 连线）", linkCount() === 7, "links=" + linkCount());

// 4.2 诊断节点不能接措施节点
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];
const dg2 = mkNode("diagnosis/diag", 100, 100);
const ms2 = mkNode("diagnosis/measure", 400, 100);
syncVisible();
const beforeToast = toastCount();
drag(anchor(dg2, 1), anchor(ms2, 3));
check("诊断节点不能直接接措施节点", linksBetween(dg2, ms2) === 0, "links=" + linksBetween(dg2, ms2));
check("诊断→措施 被拒且有气泡", toastCount() === beforeToast + 1 &&
  lastToastText().indexOf("诊断节点") !== -1 && lastToastText().indexOf("措施") !== -1, lastToastText());

// 4.3 诊断动作不能接措施节点
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];
const ac2 = mkNode("diagnosis/action", 100, 100);
const ms3 = mkNode("diagnosis/measure", 400, 100);
syncVisible();
drag(anchor(ac2, 1), anchor(ms3, 3));
check("诊断动作不能直接接措施节点", linksBetween(ac2, ms3) === 0);

// 4.4 结论只能接措施（不能接诊断节点）
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];
const cj2 = mkNode("diagnosis/conclusion", 100, 100);
const dg3 = mkNode("diagnosis/diag", 400, 100);
syncVisible();
drag(anchor(cj2, 1), anchor(dg3, 3));
check("结论不能接诊断节点", linksBetween(cj2, dg3) === 0, "links=" + linksBetween(cj2, dg3));

// 4.5 措施只能接问题解决（不能接诊断/结论）
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];
const ms4 = mkNode("diagnosis/measure", 100, 100);
const cj3 = mkNode("diagnosis/conclusion", 400, 100);
syncVisible();
drag(anchor(ms4, 1), anchor(cj3, 3));
check("措施不能接结论", linksBetween(ms4, cj3) === 0);

// 4.6 结论前面只能接诊断节点/诊断动作（措施不能接结论）
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];
const ms5 = mkNode("diagnosis/measure", 100, 100);
const cj4 = mkNode("diagnosis/conclusion", 400, 100);
syncVisible();
drag(anchor(ms5, 1), anchor(cj4, 3)); // 措施→结论（非法，措施只能接 resolved）
check("措施→结论 被拒", linksBetween(ms5, cj4) === 0);

// 4.7 终止节点（上升/继续活动）不能发出连接
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];
const es2 = mkNode("diagnosis/escalate", 100, 100);
const dg4 = mkNode("diagnosis/diag", 400, 100);
syncVisible();
drag(anchor(es2, 1), anchor(dg4, 3));
check("上升是终点，不能发出连接", linksBetween(es2, dg4) === 0);

// 4.8 问题解决只能接继续活动/上升
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];
const rv2 = mkNode("diagnosis/resolved", 100, 100);
const dg5 = mkNode("diagnosis/diag", 400, 100);
syncVisible();
drag(anchor(rv2, 1), anchor(dg5, 3));
check("问题解决不能接诊断节点", linksBetween(rv2, dg5) === 0);

console.log("== 5. 单父约束 + 环路 + 只允许锚点对锚点 ==");
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];
const P1 = mkNode("diagnosis/diag", 100, 100);
const P2 = mkNode("diagnosis/diag", 400, 100);
const P3 = mkNode("diagnosis/diag", 700, 100);
syncVisible();
drag(anchor(P1, 1), anchor(P2, 3));
drag(anchor(P2, 1), anchor(P3, 3));
check("P1→P2→P3 建链成功", linksBetween(P1, P2) === 1 && linksBetween(P2, P3) === 1);

const b1 = toastCount();
drag(anchor(P3, 1), anchor(P2, 0)); // P2 已有父节点
check("单父约束：第二次上游被拒绝", linksBetween(P3, P2) === 0 && linkCount() === 2);
check("单父气泡文案", toastCount() === b1 + 1 && lastToastText().indexOf("父节点") !== -1, lastToastText());

drag(anchor(P3, 1), anchor(P1, 0)); // 形成环路 P1→P2→P3→P1
check("环路被拒绝", linksBetween(P3, P1) === 0 && linkCount() === 2);

const beforeLinks = linkCount();
const beforeToasts = toastCount();
drag(anchor(P1, 1), [P3.pos[0] + 70, P3.pos[1] + 55]); // 释放点在主体中部
check("拖到节点主体不自动连线", linkCount() === beforeLinks && toastCount() === beforeToasts);

press(anchor(P2, 1)); release(anchor(P2, 1)); // 原地松手
check("锚点原地松手：不连线、不弹气泡", linkCount() === beforeLinks && toastCount() === beforeToasts);

console.log("== 6. 槽位隐藏包装与形状绘制 ==");
const ctx = canvas.canvas.getContext();
let threw = null;
try { canvas.drawNode(P1, ctx); } catch (e) { threw = e; }
check("drawNode（隐藏默认槽位）不抛错", !threw, threw && threw.message);
check("绘制后 inputs/outputs 已恢复（4+4）", P1.inputs.length === 4 && P1.outputs.length === 4);

console.log("== 7. 气泡组件本身 ==");
sandbox.window.DiagFlowUI.toast("测试信息", "info");
check("toast 入驻右下角容器", toastCount() >= 1);
const tEl = ids["toast-host"].children[ids["toast-host"].children.length - 1];
check("气泡带类型 accent 与显示类",
  tEl.className.indexOf("toast-info") !== -1 && tEl.classList.contains("toast-show"));

console.log("== 8. 双击节点不再异步弹出属性面板 ==");
const LG = sandbox.LiteGraph;
let panelCalls = 0;
canvas.onShowNodePanel = () => { panelCalls++; };

canvas.processNodeDblClicked(P1);
canvas.processNodeDblClicked(P2);
check("诊断节点 processNodeDblClicked 不调 onShowNodePanel", panelCalls === 0, "调了 " + panelCalls + " 次");

const builtin = LG.createNode("basic/const");
builtin.pos = [0, 0]; graph.add(builtin);
canvas.processNodeDblClicked(builtin);
check("内置节点 processNodeDblClicked 仍走原版", panelCalls === 1, "调了 " + panelCalls + " 次");

panelCalls = 0;
sandbox.prompt = () => "_edited_";
P1.onDblClick();
canvas.processNodeDblClicked(P1);
check("完整链路：双击诊断节点 → prompt → 不触发面板", panelCalls === 0, "调了 " + panelCalls + " 次");

console.log("== 9. 双击后单击不再弹出右键菜单（pointer_is_double 残留修复） ==");
syncVisible();

canvas.pointer_is_double = true;
canvas.pointer_is_down = false;
let ctxMenuCalls = 0;
const origCtxMenu = canvas.processContextMenu;
canvas.processContextMenu = function () { ctxMenuCalls++; };

const targetNode = P2;
const tp = [targetNode.pos[0] + targetNode.size[0] * 0.5, targetNode.pos[1] + targetNode.size[1] * 0.5];
press(tp[0], tp[1]);
check("双击残留 pointer_is_double 后，单击节点不再弹右键菜单", ctxMenuCalls === 0,
  "processContextMenu 被调了 " + ctxMenuCalls + " 次");

canvas.processContextMenu = origCtxMenu;
ctxMenuCalls = 0;
canvas.pointer_is_double = false;
canvas.pointer_is_down = false;
canvas.__dblState = null;

const nPos = [targetNode.pos[0] + 20, targetNode.pos[1] + 20];
NOW = 20000;
press(nPos[0], nPos[1]);
NOW = 20100;
press(nPos[0], nPos[1]);

const doubleAfterFlag = canvas.pointer_is_double;
check("双击消费后 pointer_is_double 已复位", doubleAfterFlag === false, "pointer_is_double=" + doubleAfterFlag);

NOW = 20300;
const otherNode = P1;
const op = [otherNode.pos[0] + 20, otherNode.pos[1] + 20];
ctxMenuCalls = 0;
press(op[0], op[1]);
check("双击后的第三击为正常单击（不弹右键菜单）", ctxMenuCalls === 0,
  "processContextMenu 被调了 " + ctxMenuCalls + " 次");

console.log("== 10. 右键拖拽画布（覆盖网页右键手势） ==");
// 右键按下：应进入拖动画布而非弹右键菜单
syncVisible();
canvas.processContextMenu = function () { ctxMenuCalls++; };
ctxMenuCalls = 0;
canvas.dragging_canvas = false;
canvas.__dblState = null;

// 右键在节点上按下（任意位置都应拖画布，而非选中节点/弹菜单）
const rightNode = P2;
const rp = [rightNode.pos[0] + rightNode.size[0] * 0.5, rightNode.pos[1] + rightNode.size[1] * 0.5];
const beforeOffset = [canvas.ds.offset[0], canvas.ds.offset[1]];
canvas._mousedown_callback(evBtn(rp[0], rp[1], 3, 2));
check("右键按下后 dragging_canvas = true", canvas.dragging_canvas === true,
  "dragging_canvas=" + canvas.dragging_canvas);
check("右键按下不弹右键菜单", ctxMenuCalls === 0, "processContextMenu 被调了 " + ctxMenuCalls + " 次");
check("右键按下后 last_mouse 已记录", canvas.last_mouse[0] === rp[0] && canvas.last_mouse[1] === rp[1]);

// 右键移动 → 画布平移（模拟 processMouseMove 的 dragging_canvas 分支）
const moveEv = { clientX: rp[0] + 30, clientY: rp[1] + 20, canvasX: rp[0] + 30, canvasY: rp[1] + 20,
  which: 3, button: 2, preventDefault() {}, stopPropagation() {} };
canvas._mousemove_callback(moveEv);
check("右键移动后画布偏移量变化（30,20 像素）",
  Math.abs((canvas.ds.offset[0] - beforeOffset[0]) * canvas.ds.scale - 30) < 0.5 &&
  Math.abs((canvas.ds.offset[1] - beforeOffset[1]) * canvas.ds.scale - 20) < 0.5,
  "offset delta=" + ((canvas.ds.offset[0] - beforeOffset[0]) * canvas.ds.scale) + "," + ((canvas.ds.offset[1] - beforeOffset[1]) * canvas.ds.scale));

// 右键松开 → 停止拖拽
canvas._mouseup_callback(evBtn(rp[0] + 30, rp[1] + 20, 3, 2));
check("右键松开后 dragging_canvas = false", canvas.dragging_canvas === false);

// 右键空白处按下同样拖画布（不是弹「添加节点」菜单）
ctxMenuCalls = 0;
canvas.dragging_canvas = false;
canvas._mousedown_callback(evBtn(30, 30, 3, 2));
check("右键空白处按下也拖画布（不弹菜单）", canvas.dragging_canvas === true && ctxMenuCalls === 0);

// 左键仍走原逻辑：右键拖拽不应破坏左键
canvas.dragging_canvas = false;
canvas._mouseup_callback(evBtn(30, 30, 3, 2)); // 复位

console.log("== 11. 就地文本编辑（PPT 风格文本框） ==");
syncVisible();
const editNode = mkNode("diagnosis/diag", 300, 300);
editNode.properties.data = "原始排查项";

// 触发就地编辑
sandbox.DiagFlowUI.startTextEdit(editNode);

// 文本框已创建并挂到 canvas-wrap
const cw = ids["canvas-wrap"];
check("就地文本框已挂载到画布容器", cw.children.some((c) => c.className === "node-text-edit"),
  "children=" + cw.children.length);
const editWrap = cw.children.find((c) => c.className === "node-text-edit");
check("文本框包含主 textarea", !!editWrap && editWrap.children.length >= 1);
const mainTA = editWrap && editWrap.children[0];
check("主文本框预填当前文本", mainTA && mainTA.value === "原始排查项", "value=" + (mainTA && mainTA.value));

// 修改文本并模拟提交（再次 startTextEdit 触发旧会话提交）
mainTA.value = "新的排查项文本";
sandbox.DiagFlowUI.startTextEdit(editNode);
check("再次编辑提交旧会话：data 已写回", editNode.properties.data === "新的排查项文本",
  "data=" + editNode.properties.data);

// 验证固定文本节点（继续活动）不触发编辑
const contNode = mkNode("diagnosis/continue", 600, 300);
let contEditCalled = false;
const origStartEdit = sandbox.DiagFlowUI.startTextEdit;
sandbox.DiagFlowUI.startTextEdit = function (n) { contEditCalled = true; };
contNode.onDblClick();
check("继续活动双击不触发编辑", contEditCalled === false);
sandbox.DiagFlowUI.startTextEdit = origStartEdit;

console.log("== 12. 规则引擎结构 & 全局检查（GRAPH_RULES / runGlobalChecks） ==");
// section 10 右键拖拽改动了 ds.offset/scale，这里复位以使用纯净坐标系（贴近真实初始状态）
canvas.ds.offset = [0, 0];
canvas.ds.scale = 1;
syncVisible();

// 12.1 连线规则数组结构
const linkRuleIds = (sandbox.DiagFlowNodes.LINK_RULES || []).map((r) => r.id).sort();
check("LINK_RULES 含 5 条连线规则", linkRuleIds.length === 5, linkRuleIds.join(","));
check("LINK_RULES 含预期 id", ["no-cycle", "no-self", "single-parent", "start-is-source-only", "type-compat"]
  .every((id) => linkRuleIds.indexOf(id) !== -1), linkRuleIds.join(","));
check("每条连线规则都有 test 函数", (sandbox.DiagFlowNodes.LINK_RULES || []).every((r) => typeof r.test === "function"));

// 12.2 全局规则数组结构（通过 DiagFlowUI 暴露）
const graphRuleIds = (sandbox.DiagFlowUI.GRAPH_RULES || []).map((r) => r.id).sort();
check("GRAPH_RULES 含 3 条全局规则", graphRuleIds.length === 3, graphRuleIds.join(","));
check("GRAPH_RULES 含 single-start/reachable/terminal-closure",
  ["reachable", "single-start", "terminal-closure"].every((id) => graphRuleIds.indexOf(id) !== -1),
  graphRuleIds.join(","));
check("每条全局规则都有 check 函数", (sandbox.DiagFlowUI.GRAPH_RULES || []).every((r) => typeof r.check === "function"));

// 12.3 合法且闭合的图 → 无 error
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];
const S = mkNode("diagnosis/start", 100, 100);
const D = mkNode("diagnosis/diag", 300, 100);
const C = mkNode("diagnosis/conclusion", 500, 100);
const M = mkNode("diagnosis/measure", 700, 100);
const R = mkNode("diagnosis/resolved", 900, 100);
const CO = mkNode("diagnosis/continue", 1100, 100);
syncVisible();
drag(anchor(S, 1), anchor(D, 3));
drag(anchor(D, 1), anchor(C, 3));
drag(anchor(C, 1), anchor(M, 3));
drag(anchor(M, 1), anchor(R, 3));
drag(anchor(R, 1), anchor(CO, 3));
const allClosed = sandbox.DiagFlowUI.runGlobalChecks();
check("闭合合法图：runGlobalChecks 无问题", allClosed.length === 0, allClosed.join(" / "));
check("闭合合法图：仅 error 级检查也无问题", sandbox.DiagFlowUI.runGlobalChecks({ onlyErrors: true }).length === 0);

// 12.4 开放的图（diag→diag 末端未接问题解决/上升）→ terminal-closure error
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];
const S2 = mkNode("diagnosis/start", 100, 100);
const D1b = mkNode("diagnosis/diag", 300, 100);
const D2b = mkNode("diagnosis/diag", 500, 100);
syncVisible();
drag(anchor(S2, 1), anchor(D1b, 3));
drag(anchor(D1b, 1), anchor(D2b, 3)); // D1b 链路末端 D2b 非终结节
const openErrs = sandbox.DiagFlowUI.runGlobalChecks({ onlyErrors: true });
check("开放图：仅 error 检查命中末端未闭合", openErrs.some((s) => s.indexOf("末端未接到") !== -1),
  openErrs.join(" / "));

// 12.5 缺少起点 → single-start error（注：多个起点已被 onNodeAdded 在添加时拦截，
//     故这里测"缺少起点"这一 runGlobalChecks 实际会命中的分支）
graph.clear();
bodyChildren.length = 0; delete ids["toast-host"];
mkNode("diagnosis/diag", 100, 100); // 只有诊断节点、无起点
syncVisible();
const startErrs = sandbox.DiagFlowUI.runGlobalChecks({ onlyErrors: true });
check("缺少起点：命中 single-start 错误", startErrs.some((s) => s.indexOf("缺少【诊断起点】") !== -1),
  startErrs.join(" / "));

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
