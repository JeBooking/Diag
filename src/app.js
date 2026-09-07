/* =============================================================
 * app.js —— 诊断决策树流程图编辑器
 * ============================================================= */
(function () {
  "use strict";
  var LiteGraph = window.LiteGraph;
  var LGraph = window.LGraph;
  var LGraphCanvas = window.LGraphCanvas;

  /* ---------- 状态面板（左下角长文本）+ PyCharm 风格提示气泡（右下角） ---------- */
  var statusEl = document.getElementById("status");
  function showStatus(text) {
    statusEl.textContent = text;
  }
  // 连接约束被拒绝等即时反馈：深色气泡 + 左侧彩色竖条，
  // 右下角堆叠、4 秒自动消失，带滑入/淡出动画。
  var TOAST_ACCENT = { info: "#4a88c7", warn: "#f0a742", error: "#ff5c57" };
  function showToast(message, type) {
    var host = document.getElementById("toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      document.body.appendChild(host);
    }
    var el = document.createElement("div");
    el.className = "toast toast-" + (TOAST_ACCENT[type] ? type : "info");
    el.style.setProperty("--toast-accent", TOAST_ACCENT[type] || TOAST_ACCENT.info);

    var bar = document.createElement("span");
    bar.className = "toast-bar";
    var text = document.createElement("span");
    text.className = "toast-text";
    text.textContent = message;
    var close = document.createElement("span");
    close.className = "toast-close";
    close.textContent = "×";
    close.onclick = function () { dismiss(el); };

    el.appendChild(bar); el.appendChild(text); el.appendChild(close);
    host.appendChild(el);
    // 强制 reflow 后加显示类，触发滑入动画
    void el.offsetWidth;
    el.classList.add("toast-show");

    var timer = null;
    function dismiss(node) {
      if (!node.parentNode) return;
      if (timer) { clearTimeout(timer); timer = null; }
      node.classList.remove("toast-show"); // 触发淡出动画
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 300);
    }
    timer = setTimeout(function () { dismiss(el); }, 4000);
  }
  window.DiagFlowUI = {
    toast: showToast
  };

  /* ---------- 画布 ---------- */
  var graph = new LGraph();

  // =============================================================
  // 【必须放在 new LGraphCanvas 之前】原型包装。
  // litegraph 构造画布时会把事件回调固化为当时的原型方法：
  //   this._mousedown_callback = this.processMouseDown.bind(this)（litegraph.js:5704）
  // 若在构造之后才改 prototype.processMouseDown，已 bind 的回调仍指向原版函数，
  // 包装完全不生效（此前几版双击修复在浏览器里无效正是这个原因）。
  // =============================================================

  // --- 经典双击判定接管：时间 + 距离 + 配对消费 ---
  // litegraph 的双击判定是「滚动窗口」：任意相邻两次 mousedown 间隔 <300ms 即算
  // 双击（is_double_click = now - last_mouseclick < 300，litegraph.js:5958），既没有
  // 距离判断、也没有「配对消费」语义，导致：①双击开框后快速点别处，第 2、3 击被
  // 再次配成双击，框在新位置重弹；②快速点不同位置也会反复误弹框。
  // 照抄经典双击判定（Windows/macOS/DOM dblclick 同款三条件）：
  //   1) 时间：两次点击间隔 < 300ms（沿用库自身的时间窗，保证与库内判定一致）
  //   2) 距离：两次落点相距 ≤ 10px（人手双击的正常抖动范围）
  //   3) 配对消费：一旦配成双击即消费掉，第三击是全新单击（与第四击才能再配对）
  // 通过控制 litegraph 的 last_mouseclick，让库内所有 is_double_click 消费点
  //（空白弹框 6267、节点 onDblClick 6182、端口双击 6072/6103）与本状态机一致：
  // 非双击 → 调用前把 last_mouseclick 清零（库必判单击）；双击 → 调用后清零（消费）。
  var _origProcessMouseDown = LGraphCanvas.prototype.processMouseDown;
  var DBL_TIME = 300;   // 与 litegraph 5958 行时间窗一致
  var DBL_DIST2 = 100;  // 10px 位置容差（平方）
  LGraphCanvas.prototype.processMouseDown = function (e) {
    // === 右键拖拽画布 ===
    // 覆盖网页默认右键手势：右键在画布内任意位置（空白/节点上）按下都进入
    // 「平移画布」，不再弹出 litegraph 的右键菜单（processContextMenu）。
    // 做法：把右键降级为「拖动画布」手势——设置 dragging_canvas，并记录
    // last_mouse 供 processMouseMove 计算 delta；随后 processMouseMove 的
    // `else if (this.dragging_canvas)` 分支会平移 ds.offset，processMouseUp
    // 的 `else if (e.which == 3)` 分支会复位 dragging_canvas。全程不进入
    // 原版右键菜单分支（6351 行的 `e.which == 3 || pointer_is_double`）。
    if (e && e.which === 3) {
      this.dragging_canvas = true;
      this.last_mouse = [e.clientX, e.clientY];
      this.last_mouseclick = 0;   // 右键不参与双击判定
      if (this.__dblState) this.__dblState.consumed = true;
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      return false;
    }
    if (e && typeof e.clientX === "number") {
      var st = this.__dblState || (this.__dblState = { t: -1e9, x: 0, y: 0, consumed: true });
      var now = LiteGraph.getTime();
      var dx = e.clientX - st.x;
      var dy = e.clientY - st.y;
      // is_primary 判定照抄 litegraph 5957 行
      var isPrimary = e.isPrimary === undefined || !e.isPrimary;
      var willBeDouble = !!(isPrimary && !st.consumed &&
        now - st.t < DBL_TIME && dx * dx + dy * dy <= DBL_DIST2);
      if (!willBeDouble) this.last_mouseclick = 0; // 强制库按单击处理
      var result = _origProcessMouseDown.apply(this, arguments);
      if (willBeDouble) {
        st.consumed = true;       // 配对已消费：第三击从头计数
      } else {
        st.t = now;
        st.x = e.clientX;
        st.y = e.clientY;
        st.consumed = false;
      }
      this.last_mouseclick = willBeDouble ? 0 : now; // 与状态机保持同步
      // 关键修复：双击手势结束后，强制清掉 litegraph 的 pointer_is_double 标志。
      // litegraph 在 processMouseDown 开头若检测到 pointer_is_down 仍为 true（即
      // 第二击 mousedown 早于第一击 mouseup 到达，或 prompt 同步阻塞导致 mouseup
      // 延迟/丢失），会置 pointer_is_double=true；此后 processMouseUp 若未走
      // is_primary 分支复位，该标志会残留到下一次单击，使「单击」被误判进
      // processMouseDown 的 `else if (e.which == 3 || pointer_is_double)` 分支，
      // 弹出右键菜单。双击消费后强制复位，保证下一击是干净的单击。
      if (willBeDouble) this.pointer_is_double = false;
      return result;
    }
    return _origProcessMouseDown.apply(this, arguments);
  };

  // --- 搜索框点外关闭 ---
  // litegraph 的搜索框只支持 ESC / 选中节点项 / 鼠标移开 500ms 三种关闭方式，
  // 这里补上「点击框外（画布空白处、其他节点等）即关闭」：
  // 捕获阶段在 document 监听 mousedown（画布默认也绑 mousedown），点框外时
  // 阻断传播并关框，画布收不到这一击；框已被 ESC 等关闭时放行并解绑。
  // 配合上面的双击根修，无需再做手势级拦截或时间窗兜底。
  var _origShowSearchBox = LGraphCanvas.prototype.showSearchBox;
  LGraphCanvas.prototype.showSearchBox = function (event, options) {
    var result = _origShowSearchBox.apply(this, arguments);
    var dialog = (result && result.close) ? result : this.search_box;
    if (dialog && typeof dialog.close === "function" && !dialog.__outsideCloseBound) {
      dialog.__outsideCloseBound = true;
      var rootDoc = (this.canvas && this.canvas.ownerDocument) || document;
      var outsideCloser = function (e) {
        // 点击发生在框内部（输入框/结果列表）→ 放行
        if (dialog.contains(e.target)) return;
        rootDoc.removeEventListener("mousedown", outsideCloser, true);
        // 框已被 ESC/选中项关闭 → 放行本次点击
        if (!dialog.parentNode) return;
        // 框还开着 → 吞掉这一击并关框（画布无感，不会误触发双击或取消选中）
        if (e.stopPropagation) e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
        dialog.close();
      };
      setTimeout(function () {
        rootDoc.addEventListener("mousedown", outsideCloser, true);
      }, 0);
    }
    return result;
  };

  // --- 双击节点不再弹出默认的「节点属性面板」---
  // litegraph 在 processMouseUp 判定为双击节点后，会调用：
  //   1) node.onDblClick（我们的诊断节点自定义为弹 prompt 编辑文本）
  //   2) this.processNodeDblClicked(node) → 内部 setTimeout 100ms 后调用
  //      showShowNodePanel(n)，异步弹出节点属性面板（用户感觉到的"菜单栏"）
  // 问题：prompt 关闭后第 2 步继续执行，setTimeout 的面板在 100ms 后延迟弹出，
  // 用户感觉"关闭 prompt 后再单击别的节点时弹出了菜单栏"——其实是诊断节点的
  // 默认属性面板在异步弹出来。诊断节点已经自定义了双击行为，这里直接屏蔽
  // 默认面板（内置节点不受影响，继续享受原生的属性面板/默认值编辑功能）。
  var _origProcessNodeDblClicked = LGraphCanvas.prototype.processNodeDblClicked;
  LGraphCanvas.prototype.processNodeDblClicked = function (n) {
    if (n && typeof n.type === "string" && n.type.indexOf("diagnosis/") === 0) return;
    return _origProcessNodeDblClicked.apply(this, arguments);
  };

  var canvas = new LGraphCanvas("#graph-canvas", graph);
  // 右键菜单只显示带 filter="diagnosis" 标记的节点（litegraph 内置的 176 个
  // basic/*、events/*、widget/* 等节点对「诊断决策树」无用，全部从菜单隐藏）
  canvas.filter = "diagnosis";
  graph.start();

  /* ---------- 就地文本编辑（PPT/draw.io 风格文本框，替代 window.prompt） ---------- */
  // 双击节点 → 在节点位置覆盖一个可编辑的 HTML 文本框；Enter 提交、Esc 取消、
  // 点击框外（含画布/其他节点）提交。编辑期间不干扰画布拖拽/连线（文本框自身
  // 拦截 mousedown 阻止冒泡）。
  var textEdit = null; // 当前编辑会话 { node, wrap, main, sub, field, extraField }

  function closeTextEdit(commit) {
    if (!textEdit) return;
    var s = textEdit;
    textEdit = null;
    if (commit) {
      var def = window.DiagFlowNodes.NODE_DEFS[s.node.type];
      if (def.textField && s.main) {
        s.node.properties[def.textField] = s.main.value;
      }
      if (def.extraField && s.sub) {
        s.node.properties[def.extraField] = s.sub.value;
      }
      s.node.setDirtyCanvas(true, false);
      canvas.setDirty(true, true);
    }
    if (s.wrap.parentNode) s.wrap.parentNode.removeChild(s.wrap);
  }

  function startTextEdit(node) {
    var def = window.DiagFlowNodes.NODE_DEFS[node.type];
    if (!def || !def.textField) return;
    // 已有编辑会话：先提交旧的
    if (textEdit) closeTextEdit(true);

    var wrap = document.createElement("div");
    wrap.className = "node-text-edit";
    wrap.style.position = "absolute";
    wrap.style.pointerEvents = "auto";
    wrap.style.zIndex = "10001";

    var main = document.createElement("textarea");
    main.className = "node-text-edit-main";
    main.value = node.properties[def.textField] || "";
    main.placeholder = "输入文本…";
    main.rows = 3;
    main.spellcheck = false;

    var sub = null;
    if (def.extraField) {
      sub = document.createElement("input");
      sub.type = "text";
      sub.className = "node-text-edit-sub";
      sub.value = node.properties[def.extraField] || "";
      sub.placeholder = "后续动作（持久传递）";
      sub.spellcheck = false;
    }

    wrap.appendChild(main);
    if (sub) wrap.appendChild(sub);

    // 定位：节点画布坐标 → 屏幕坐标，覆盖在节点主体上方（略外扩便于输入）
    var pad = 6;
    var topleft = canvas.convertCanvasToOffset([node.pos[0], node.pos[1]]);
    var sizePx = [node.size[0] * canvas.ds.scale, node.size[1] * canvas.ds.scale];
    wrap.style.left = (topleft[0] - pad) + "px";
    wrap.style.top = (topleft[1] - pad) + "px";
    wrap.style.width = (sizePx[0] + pad * 2) + "px";
    wrap.style.minHeight = (sizePx[1] + pad * 2) + "px";

    var host = document.querySelector(".canvas-wrap") || document.body;
    host.appendChild(wrap);

    textEdit = { node: node, wrap: wrap, main: main, sub: sub };

    // 阻断事件冒泡，避免画布收到拖拽/连线事件
    function swallow(e) { if (e.stopPropagation) e.stopPropagation(); }

    wrap.addEventListener("mousedown", swallow);
    wrap.addEventListener("mouseup", swallow);
    wrap.addEventListener("dblclick", swallow);
    wrap.addEventListener("wheel", function (e) { if (e.stopPropagation) e.stopPropagation(); });

    // 提交：Enter（主文本框，不带 Shift）；副输入框 Enter 也提交
    main.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); closeTextEdit(true); }
      else if (e.key === "Escape") { e.preventDefault(); closeTextEdit(false); }
      else if (e.key === "Enter" && e.shiftKey && sub) { sub.focus(); }
    });
    if (sub) {
      sub.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); closeTextEdit(true); }
        else if (e.key === "Escape") { e.preventDefault(); closeTextEdit(false); }
      });
    }

    // 点击框外提交（document 捕获阶段，但排除本框内部）
    setTimeout(function () {
      document.addEventListener("mousedown", outsideCommit, true);
    }, 0);
    function outsideCommit(e) {
      if (!textEdit) { document.removeEventListener("mousedown", outsideCommit, true); return; }
      if (textEdit.wrap.contains(e.target)) return; // 框内点击放行
      e.stopPropagation();
      e.preventDefault();
      closeTextEdit(true);
      document.removeEventListener("mousedown", outsideCommit, true);
    }

    main.focus();
    main.select();
  }

  // 暴露给 diagnosis-nodes.js 的 onDblClick 调用
  window.DiagFlowUI.startTextEdit = startTextEdit;

  // 覆盖网页右键手势：画布容器内右键一律阻止浏览器默认菜单（拖拽画布用）
  var canvasWrap = document.querySelector(".canvas-wrap");
  if (canvasWrap) {
    canvasWrap.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
  }


  // 单一入口约束：全局拦截，右键菜单 / 面板添加都生效
  graph.onNodeAdded = function (node) {
    if (node.type === "diagnosis/start") {
      var starts = graph.findNodesByType("diagnosis/start");
      if (starts.length > 1) {
        alert("诊断流程只能有一个「诊断起点」节点，已移除多余起点。");
        graph.remove(node);
      }
    }
  };

  // 画布随容器尺寸自适应
  function resizeCanvas() {
    var wrap = document.querySelector(".canvas-wrap");
    if (!wrap) return;
    canvas.canvas.width = wrap.clientWidth;
    canvas.canvas.height = wrap.clientHeight;
    canvas.resize();
    canvas.setDirty(true, true);
  }
  window.addEventListener("resize", resizeCanvas);

  /* ---------- 选中节点：流向动画 + 父子节点发光 ---------- */
  // 颜色方案：父节点(上游)红光 / 子节点(下游)绿光 / 连线流向青色
  var FLOW = {
    parent: "rgba(229,57,53,0.95)",  // 红：上游父节点
    child:  "rgba(67,160,71,0.95)",  // 绿：下游子节点
    flow:   "#26c6da",               // 青：流向光点
    flowCore: "#b2ebf2"
  };

  function cubicBezier(p0, p1, p2, p3, t) {
    var u = 1 - t;
    var a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]
    ];
  }

  // 隐藏 litegraph 默认槽位圆点：诊断节点的上下左右四个通用锚点由节点自绘
  //（onDrawBackground）。包装 drawNode，绘制期间暂时清空 inputs/outputs，
  // 库就不会在锚点位置叠加画出默认输入/输出小圆点。
  var _origDrawNode = LGraphCanvas.prototype.drawNode;
  var EMPTY_SLOTS = [];
  LGraphCanvas.prototype.drawNode = function (node, ctx) {
    if (node && typeof node.type === "string" && node.type.indexOf("diagnosis/") === 0 &&
        !(node.flags && node.flags.collapsed)) {
      var ins = node.inputs, outs = node.outputs;
      node.inputs = EMPTY_SLOTS;
      node.outputs = EMPTY_SLOTS;
      try {
        return _origDrawNode.apply(this, arguments);
      } finally {
        node.inputs = ins;
        node.outputs = outs;
      }
    }
    return _origDrawNode.apply(this, arguments);
  };

  // 节点几何形状路径（由 diagnosis-nodes.js 提供，辉光与自绘形状保持同一轮廓）
  function nodeShapePath(ctx, node) {
    window.DiagFlowNodes.shapePath(ctx, node.type, node.pos[0], node.pos[1], node.size[0], node.size[1]);
  }

  // 真·辉光：沿节点形状轮廓由内向外三层 shadow 光晕（宽→窄、淡→亮），
  // 再给本体叠一层淡色，让节点看起来"被点亮"，而不是套一个硬边框。
  function drawNodeGlow(ctx, node, color) {
    var passes = [
      { blur: 26, width: 5,   alpha: 0.20 }, // 最外层柔光
      { blur: 14, width: 2.5, alpha: 0.42 }, // 中层过渡
      { blur: 6,  width: 1.4, alpha: 0.90 }  // 内芯亮边
    ];
    ctx.save();
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    for (var i = 0; i < passes.length; i++) {
      var p = passes[i];
      ctx.shadowColor = color;
      ctx.shadowBlur = p.blur;
      ctx.globalAlpha = p.alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = p.width;
      nodeShapePath(ctx, node);
      ctx.stroke();
    }
    // 本体染色：低透明度填充同一轮廓，节点本身像被光晕照亮
    ctx.shadowColor = "transparent";
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = color;
    nodeShapePath(ctx, node);
    ctx.fill();
    ctx.restore();
  }

  // 在前景层绘制：仅当存在选中节点时生效
  canvas.onDrawForeground = function (ctx) {
    var selMap = canvas.selected_nodes;
    if (!selMap || !Object.keys(selMap).length) return;

    var selNodes = [];
    for (var k in selMap) {
      var v = selMap[k];
      if (!v) continue;
      selNodes.push(typeof v === "object" ? v : graph.getNodeById(k));
    }
    selNodes = selNodes.filter(function (n) { return n && n.pos; });
    if (!selNodes.length) return;

    // 收集与选中节点相连的连线，以及上游父节点 / 下游子节点
    var parentSet = {}, childSet = {}, seenLink = {}, links = [];
    selNodes.forEach(function (sel) {
      for (var id in graph.links) {
        var link = graph.links[id];
        if (!link || seenLink[id]) continue;
        if (link.target_id === sel.id) {
          seenLink[id] = true; links.push(link);
          var p = graph.getNodeById(link.origin_id);
          if (p && p.id !== sel.id) parentSet[p.id] = p;
        } else if (link.origin_id === sel.id) {
          seenLink[id] = true; links.push(link);
          var c = graph.getNodeById(link.target_id);
          if (c && c.id !== sel.id) childSet[c.id] = c;
        }
      }
    });

    // 父节点红光 / 子节点绿光
    for (var pk in parentSet) drawNodeGlow(ctx, parentSet[pk], FLOW.parent);
    for (var ck in childSet)  drawNodeGlow(ctx, childSet[ck], FLOW.child);
    // 选中节点自身描白边
    selNodes.forEach(function (n) { if (n && n.pos) drawNodeGlow(ctx, n, "rgba(255,255,255,0.9)"); });

    // 连线流向动画：行进虚线 + 流动光点（从源 → 目标，即决策流向）
    var t = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    var SPEED = 0.5, GAP = 18, MARBLES = 3, R = 4;
    links.forEach(function (link) {
      var origin = graph.getNodeById(link.origin_id);
      var target = graph.getNodeById(link.target_id);
      if (!origin || !target) return;
      var p0 = origin.getConnectionPos(false, link.origin_slot); // 源输出口
      var p3 = target.getConnectionPos(true, link.target_slot);  // 目标输入口
      var dist = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
      var p1 = [p0[0] + dist * 0.25, p0[1]];
      var p2 = [p3[0] - dist * 0.25, p3[1]];

      // 行进虚线（负偏移使其由 p0 流向 p3）
      ctx.save();
      ctx.strokeStyle = FLOW.flow;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -((t * 60) % GAP);
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
      ctx.stroke();
      ctx.restore();

      // 流动光点
      ctx.save();
      ctx.shadowColor = FLOW.flow;
      ctx.shadowBlur = 12;
      ctx.fillStyle = FLOW.flowCore;
      for (var i = 0; i < MARBLES; i++) {
        var tt = ((t * SPEED) + i / MARBLES) % 1;
        var pt = cubicBezier(p0, p1, p2, p3, tt);
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], R, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  };

  // 选中时持续置脏以驱动动画；无选中则静止，节省资源
  (function flowLoop() {
    if (canvas.selected_nodes && Object.keys(canvas.selected_nodes).length) {
      // 只需置脏前景层：单画布模式下 drawFrontCanvas 内部会自行重绘背景
      canvas.setDirty(true, false);
    }
    requestAnimationFrame(flowLoop);
  })();

  /* ---------- 双击空白弹出的搜索框：点击框外任意位置关闭 ---------- */
  // 接管搜索框结果列表：litegraph 内置列表不走 canvas.filter，会混入全部 176 个
  // 内置节点；用 onSearchBox 钩子只返回诊断节点（支持按类型名或中文标题搜索）。
  var DIAG_TYPES = window.DiagFlowNodes.types; // 8 种诊断节点
  canvas.onSearchBox = function (helper, str) {
    str = (str || "").toLowerCase();
    return DIAG_TYPES.filter(function (t) {
      if (!str) return true;
      var ctor = LiteGraph.registered_node_types[t];
      var label = ((ctor && (ctor.title || "")) + " " + t).toLowerCase();
      return label.indexOf(str) !== -1;
    });
  };

  /* ---------- 节点面板添加 ---------- */
  function addNodeAtCenter(type) {
    if (type === "diagnosis/start" && graph.findNodesByType("diagnosis/start").length) {
      showToast("诊断流程只能有一个「诊断起点」节点", "warn");
      return;
    }
    var node = LiteGraph.createNode(type);
    var rect = canvas.canvas.getBoundingClientRect();
    var p = canvas.convertOffsetToCanvas(rect.width / 2, rect.height / 2);
    node.pos = [p[0] - node.size[0] / 2, p[1] - node.size[1] / 2];
    graph.add(node);
    canvas.setDirty(true, true);
  }
  document.querySelectorAll(".palette-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      addNodeAtCenter(btn.getAttribute("data-type"));
    });
  });

  /* ---------- 清空 ---------- */
  function clearGraph() {
    if (graph._nodes.length && !confirm("确定清空当前流程图？")) return;
    graph.clear();
    showStatus("画布已清空。点击「加载示例」可恢复演示流程。");
  }

  /* ---------- 加载示例：设备无法开机诊断（完整排查闭环） ---------- */
  // 连线约定：从「右锚点」拖出连到「左锚点」（锚点序号：0上 1右 2下 3左）。
  // 注意 anchor 序号只决定位置；输出/输入身份由拖拽行为决定。
  function loadSample() {
    graph.clear();

    var start = LiteGraph.createNode("diagnosis/start");
    start.pos = [60, 380];
    start.properties.scenario = "设备无法开机诊断";
    graph.add(start);

    var d1 = LiteGraph.createNode("diagnosis/diag");   // 诊断节点
    d1.pos = [320, 360];
    d1.properties.data = "检查电源指示灯是否亮起";
    graph.add(d1);

    var a1 = LiteGraph.createNode("diagnosis/action"); // 诊断动作
    a1.pos = [320, 560];
    a1.properties.action = "重新插拔电源线";
    a1.properties.followup = "观察指示灯变化";
    graph.add(a1);

    var d2 = LiteGraph.createNode("diagnosis/diag");
    d2.pos = [600, 360];
    d2.properties.data = "指示灯仍不亮，测量适配器输出电压";
    graph.add(d2);

    var c1 = LiteGraph.createNode("diagnosis/conclusion"); // 结论节点
    c1.pos = [880, 360];
    c1.properties.conclusion = "电源适配器故障";
    graph.add(c1);

    var m1 = LiteGraph.createNode("diagnosis/measure");    // 措施节点
    m1.pos = [1140, 360];
    m1.properties.measure = "更换电源适配器";
    graph.add(m1);

    var r1 = LiteGraph.createNode("diagnosis/resolved");   // 问题解决
    r1.pos = [1380, 360];
    r1.properties.judgement = "问题是否解决？";
    graph.add(r1);

    var cont = LiteGraph.createNode("diagnosis/continue"); // 继续活动
    cont.pos = [1380, 200];
    graph.add(cont);

    var esc = LiteGraph.createNode("diagnosis/escalate");  // 上升
    esc.pos = [1380, 540];
    esc.properties.reason = "适配器更换后仍无法开机，需上升研发";
    graph.add(esc);

    // 连线：右锚点(1) → 左锚点(3)
    start.connect(1, d1, 3);
    d1.connect(1, a1, 3);
    a1.connect(1, d2, 3);
    d2.connect(1, c1, 3);
    c1.connect(1, m1, 3);
    m1.connect(1, r1, 3);
    r1.connect(1, cont, 3);   // 解决 → 继续活动
    r1.connect(1, esc, 3);    // 未解决 → 上升

    canvas.setDirty(true, true);
    showStatus("已加载示例：「设备无法开机」完整排查闭环。\n诊断节点 → 诊断动作 → 结论 → 措施 → 问题解决 →（继续活动 / 上升）。\n从节点边缘锚点拖出连线；受类型约束严格限制。");
  }

  /* ---------- 压力测试：生成 ~100 节点的诊断流程图 ---------- */
  function loadStressTest() {
    var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    graph.clear();

    // 结构：起点(1) → 深度 0~5 诊断层（每层节点数 2^layer）→ 末端闭环
    // 中间层用「诊断节点」，末端接到「结论/措施/问题解决/继续活动」
    var COL_W = 220;
    var ROW_H = 120;
    var ORIGIN_X = 40;
    var ORIGIN_Y = 40;
    var byLayer = [];
    var start = LiteGraph.createNode("diagnosis/start");
    start.pos = [ORIGIN_X, ORIGIN_Y + 6 * ROW_H];
    start.properties.scenario = "压力测试：100 节点诊断流程图";
    graph.add(start);
    byLayer.push([start]);

    var layers = [1, 2, 4, 8, 16, 32]; // 深度 1~5 的诊断节点数（二叉）
    layers.forEach(function (count, i) {
      var layer = i + 1;
      var nodes = [];
      var colX = ORIGIN_X + layer * COL_W;
      var span = (count - 1) * ROW_H;
      for (var k = 0; k < count; k++) {
        var q = LiteGraph.createNode("diagnosis/diag");
        q.pos = [colX, ORIGIN_Y + k * ROW_H + 160 - span / 2];
        q.properties.data = "层级 " + layer + " 排查项 #" + (k + 1);
        graph.add(q);
        nodes.push(q);
      }
      byLayer.push(nodes);
    });

    // 末端闭环：32 个诊断节点 → 各接一个 结论→措施→问题解决→继续活动 短链
    var leafX = ORIGIN_X + 6 * COL_W;
    var tailNodes = [];
    var tailCount = 32;
    for (var l = 0; l < tailCount; l++) {
      var c = LiteGraph.createNode("diagnosis/conclusion");
      c.pos = [leafX, ORIGIN_Y + l * ROW_H + 120 - tailCount * 30];
      c.properties.conclusion = "结论 #" + (l + 1);
      graph.add(c);

      var m = LiteGraph.createNode("diagnosis/measure");
      m.pos = [leafX + COL_W, ORIGIN_Y + l * ROW_H + 120 - tailCount * 30];
      m.properties.measure = "措施 #" + (l + 1);
      graph.add(m);

      var r = LiteGraph.createNode("diagnosis/resolved");
      r.pos = [leafX + COL_W * 2, ORIGIN_Y + l * ROW_H + 120 - tailCount * 30];
      graph.add(r);

      var cont = LiteGraph.createNode("diagnosis/continue");
      cont.pos = [leafX + COL_W * 3, ORIGIN_Y + l * ROW_H + 120 - tailCount * 30];
      graph.add(cont);

      c.connect(1, m, 3);
      m.connect(1, r, 3);
      r.connect(1, cont, 3);
      tailNodes.push(c);
    }
    byLayer.push(tailNodes);

    // 连线：中间层二叉展开（右锚 1 → 左锚 3）
    for (var L = 0; L < byLayer.length - 1; L++) {
      var parents = byLayer[L];
      var children = byLayer[L + 1];
      if (L === byLayer.length - 2) {
        // 第 5 层（32 诊断节点）→ 第 6 层（32 结论）：一一对应
        for (var p = 0; p < parents.length; p++) {
          parents[p].connect(1, children[p], 3);
        }
      } else {
        for (var i2 = 0; i2 < parents.length; i2++) {
          parents[i2].connect(1, children[i2 * 2], 3);
          parents[i2].connect(1, children[i2 * 2 + 1], 3);
        }
      }
    }

    var t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    canvas.setDirty(true, true);
    canvas.ds.scale = 0.5;
    canvas.ds.offset = [20, 20];
    canvas.setDirty(true, true);

    var total = graph._nodes.length;
    var links = Object.keys(graph.links).length;
    showStatus(
      "压力测试已加载：" + total + " 节点 / " + links + " 连线\n" +
      "生成耗时：" + (t1 - t0).toFixed(1) + " ms\n" +
      "提示：单击任意节点查看流向高亮与父子发光；可拖动/缩放/选择。"
    );
  }

  /* ---------- 验证流程结构 ---------- */
  function nodeLabel(nd) {
    var p = nd.properties || {};
    return p.data || p.action || p.conclusion || p.measure ||
           p.judgement || p.reason || p.scenario || nd.title || nd.type;
  }
  // 判断某节点是否为「终止节点」（问题解决 / 上升 / 继续活动）
  function isTerminal(type) {
    return type === "diagnosis/resolved" || type === "diagnosis/escalate" ||
           type === "diagnosis/continue";
  }
  /* -----------------------------------------------------------
   * 全局规则（GRAPH_RULES）
   *
   * 每条规则在「保存（导出）」与「验证流程」时统一执行。
   * 规则结构：
   *   id      : 唯一标识（便于定位/调试）
   *   level   : "error" = 阻断保存（标红）   "warn" = 仅提示，不阻断保存
   *   check   : function(g) -> string[]   （返回问题描述列表，不含前缀符号）
   *   g       = { graph, nodes, nodeLabel, isTerminal, reachable }
   *             reachable 为「从起点可达的节点 id 集合」，无起点时为 null
   *
   * ★ 以后新增全局约束：在此数组追加一条对象即可，保存与验证自动覆盖，
   *   无需改动 validateGraph / exportJSON 中的其它逻辑。
   * --------------------------------------------------------- */
  var GRAPH_RULES = [
    {
      id: "single-start",
      level: "error",
      check: function (g) {
        var issues = [];
        var starts = g.graph.findNodesByType("diagnosis/start");
        if (starts.length === 0) issues.push("缺少【诊断起点】节点");
        if (starts.length > 1) issues.push("存在多个【诊断起点】，应仅有一个");
        return issues;
      }
    },
    {
      id: "reachable",
      level: "warn",
      check: function (g) {
        var issues = [];
        if (!g.reachable) return issues; // 无起点时由 single-start 提示
        g.nodes.forEach(function (nd) {
          if (nd.type === "diagnosis/start") return;
          var hasParent = (nd.inputs || []).some(function (inp) {
            return inp && inp.link != null && inp.link !== -1;
          });
          if (!hasParent) {
            issues.push(g.nodeLabel(nd) + " 未接入流程（无上游连接）");
          } else if (!g.reachable[nd.id]) {
            issues.push(g.nodeLabel(nd) + " 无法从起点到达");
          }
        });
        return issues;
      }
    },
    {
      id: "terminal-closure",
      level: "error",
      check: function (g) {
        // 所有「诊断节点 / 诊断动作」链路末端必须接到【问题解决 / 上升】
        var issues = [];
        g.nodes.forEach(function (nd) {
          if (nd.type !== "diagnosis/diag" && nd.type !== "diagnosis/action") return;
          var outs = (nd.outputs || []).filter(function (o) { return (o.links || []).length > 0; });
          if (!outs.length) return; // 孤立节点由 reachable 提示
          // 收集从该节点可达的所有叶子
          var leafSet = {}, stk = [nd], seen = {};
          while (stk.length) {
            var cur = stk.pop();
            if (!cur || seen[cur.id]) continue;
            seen[cur.id] = true;
            var os = (cur.outputs || []).filter(function (o) { return (o.links || []).length > 0; });
            if (!os.length) { leafSet[cur.id] = cur; continue; }
            os.forEach(function (o) {
              (o.links || []).forEach(function (id) {
                var l = g.graph.links[id];
                if (l) stk.push(g.graph.getNodeById(l.target_id));
              });
            });
          }
          var bad = [];
          for (var k in leafSet) {
            if (!g.isTerminal(leafSet[k].type)) bad.push(leafSet[k]);
          }
          if (bad.length) {
            issues.push("「" + g.nodeLabel(nd) + "」链路末端未接到【问题解决】或【上升】（终止于：" +
              bad.map(g.nodeLabel).join("、") + "）");
          }
        });
        return issues;
      }
    }
  ];

  // 构造传给各规则的校验上下文（含从起点可达性遍历）
  function buildCheckContext() {
    var nodes = graph._nodes;
    var starts = graph.findNodesByType("diagnosis/start");
    var reachable = null;
    if (starts.length) {
      reachable = {};
      var stack = [starts[0]];
      while (stack.length) {
        var n = stack.pop();
        if (!n || reachable[n.id]) continue;
        reachable[n.id] = true;
        (n.outputs || []).forEach(function (o) {
          (o.links || []).forEach(function (id) {
            var l = graph.links[id];
            if (l) stack.push(graph.getNodeById(l.target_id));
          });
        });
      }
    }
    return { graph: graph, nodes: nodes, nodeLabel: nodeLabel, isTerminal: isTerminal, reachable: reachable };
  }

  // 统一执行全部全局规则。opts.onlyErrors=true 时只跑 error 级（供保存拦截）。
  function runGlobalChecks(opts) {
    opts = opts || {};
    var g = buildCheckContext();
    var issues = [];
    GRAPH_RULES.forEach(function (rule) {
      if (opts.onlyErrors && rule.level !== "error") return;
      var found = rule.check(g) || [];
      found.forEach(function (s) {
        issues.push((rule.level === "error" ? "✗ " : "⚠ ") + s);
      });
    });
    return issues;
  }

  function validateGraph() {
    var issues = runGlobalChecks();
    if (!issues.length) issues.push("✓ 诊断流程结构有效：单一入口、无环路、所有节点可达、链路末端均闭合。");
    showStatus("【结构验证】\n" + issues.join("\n"));
  }

  /* ---------- 推理演示（随机分支遍历到终止节点） ---------- */
  function runInference() {
    var starts = graph.findNodesByType("diagnosis/start");
    if (!starts.length) { showStatus("请先加载或构建诊断流程。"); return; }
    var node = starts[0];
    var path = ["> 起点：" + (node.properties.scenario || "诊断")];
    var guard = 0;
    while (node && !isTerminal(node.type) && guard++ < 100) {
      var outs = (node.outputs || []).filter(function (o) { return (o.links || []).length > 0; });
      if (!outs.length) { path.push("…（无可用分支，推理中断）"); break; }
      var choice = outs[Math.floor(Math.random() * outs.length)];
      var link = graph.links[choice.links[0]];
      var next = graph.getNodeById(link.target_id);
      path.push("→ " + (nodeLabel(node) || "…") + "  ⇒  " + nodeLabel(next));
      node = next;
    }
    var result = "";
    if (node && isTerminal(node.type)) {
      if (node.type === "diagnosis/continue") {
        result = "\n────────────\n问题已解决 → 继续活动";
      } else if (node.type === "diagnosis/escalate") {
        result = "\n────────────\n上升：" + (node.properties.reason || "缺少排查方向/手段");
      } else {
        result = "\n────────────\n问题解决判定：" + (node.properties.judgement || "—");
      }
    }
    showStatus("【推理演示（随机分支）】\n" + path.join("\n") + result);
  }

  /* ---------- 导入 / 导出 ---------- */
  function exportJSON() {
    // 保存前全局校验：仅跑 error 级规则（链路末端必须接到【问题解决/上升】、
    // 单一入口等），违规则拦截导出并提示
    var openIssues = runGlobalChecks({ onlyErrors: true });
    if (openIssues.length) {
      showToast("保存前校验未通过：\n" + openIssues.join("\n"), "error");
      showStatus("【保存前校验】存在未闭合链路，已拦截导出：\n" + openIssues.join("\n"));
      return;
    }
    var data = JSON.stringify(graph.serialize(), null, 2);
    var blob = new Blob([data], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "diagnosis-graph.json";
    a.click();
    showStatus("已导出 diagnosis-graph.json");
  }
  function importJSON() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = function () {
      var file = input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          graph.configure(JSON.parse(reader.result));
          showStatus("已导入诊断流程。");
        } catch (e) {
          showStatus("导入失败：" + e.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  /* ---------- 绑定工具栏 ---------- */
  document.getElementById("btn-sample").onclick = loadSample;
  document.getElementById("btn-stress").onclick = loadStressTest;
  document.getElementById("btn-clear").onclick = clearGraph;
  document.getElementById("btn-validate").onclick = validateGraph;
  document.getElementById("btn-infer").onclick = runInference;
  document.getElementById("btn-export").onclick = exportJSON;
  document.getElementById("btn-import").onclick = importJSON;

  /* ---------- 暴露规则引擎（供测试与未来扩展） ---------- */
  window.DiagFlowUI.GRAPH_RULES = GRAPH_RULES;
  window.DiagFlowUI.runGlobalChecks = runGlobalChecks;

  /* ---------- 启动 ---------- */
  resizeCanvas();
  loadSample();
})();
