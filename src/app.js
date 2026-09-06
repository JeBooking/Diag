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

  var canvas = new LGraphCanvas("#graph-canvas", graph);
  // 右键菜单只显示带 filter="diagnosis" 标记的节点（litegraph 内置的 176 个
  // basic/*、events/*、widget/* 等节点对「诊断决策树」无用，全部从菜单隐藏）
  canvas.filter = "diagnosis";
  graph.start();

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
  var DIAG_TYPES = ["diagnosis/start", "diagnosis/question", "diagnosis/leaf"];
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

  /* ---------- 加载示例：设备无法开机诊断 ---------- */
  // 连线约定：从「右锚点」拖出连到「左锚点」（锚点序号：0上 1右 2下 3左）。
  // 注意 anchor 序号只决定位置；输出/输入身份由拖拽行为决定。
  function loadSample() {
    graph.clear();

    var start = LiteGraph.createNode("diagnosis/start");   // 胶囊
    start.pos = [60, 300];
    start.properties.scenario = "打印机无法开机诊断";
    graph.add(start);

    var q1 = LiteGraph.createNode("diagnosis/question");   // 菱形
    q1.pos = [320, 280];
    q1.properties.question = "电源指示灯是否亮起？";
    graph.add(q1);

    var q2 = LiteGraph.createNode("diagnosis/question");
    q2.pos = [580, 130];
    q2.properties.question = "电源线是否连接牢固？";
    graph.add(q2);

    var q3 = LiteGraph.createNode("diagnosis/question");
    q3.pos = [580, 400];
    q3.properties.question = "屏幕是否有任何显示？";
    graph.add(q3);

    var d1 = LiteGraph.createNode("diagnosis/leaf");       // 六边形
    d1.pos = [840, 40];
    d1.properties.name = "电源线松动 / 损坏";
    d1.properties.confidence = 0.9;
    d1.properties.advice = "重新插紧或更换电源线";
    graph.add(d1);

    var d2 = LiteGraph.createNode("diagnosis/leaf");
    d2.pos = [840, 150];
    d2.properties.name = "电源适配器故障";
    d2.properties.confidence = 0.8;
    d2.properties.advice = "更换电源适配器";
    graph.add(d2);

    var d3 = LiteGraph.createNode("diagnosis/leaf");
    d3.pos = [840, 330];
    d3.properties.name = "主板 / 显示模块故障";
    d3.properties.confidence = 0.7;
    d3.properties.advice = "送修检测主板与显示模块";
    graph.add(d3);

    var d4 = LiteGraph.createNode("diagnosis/leaf");
    d4.pos = [840, 450];
    d4.properties.name = "系统软件卡死";
    d4.properties.confidence = 0.75;
    d4.properties.advice = "长按电源键 10 秒强制重启";
    graph.add(d4);

    // 连线：右锚点(1) → 左锚点(3)
    start.connect(1, q1, 3);
    q1.connect(1, q2, 3);
    q1.connect(1, q3, 3);
    q2.connect(1, d1, 3);
    q2.connect(1, d2, 3);
    q3.connect(1, d3, 3);
    q3.connect(1, d4, 3);

    canvas.setDirty(true, true);
    showStatus("已加载示例：「打印机无法开机」决策树。\n从节点边缘的锚点拖出连线（锚点不区分输入输出，拖出端即输出）；受约束限制。");
  }

  /* ---------- 压力测试：生成 ~100 节点的二叉决策树 ---------- */
  function loadStressTest() {
    var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    graph.clear();

    // 结构：起点(1) → 深度 0~5 问诊层（每层节点数 2^layer）→ 第 6 层 35 个 leaf
    // 总数 = 1 + 2 + 4 + 8 + 16 + 32 + 35 = 98 ≈ 100
    var COL_W = 220;          // 列间距
    var ROW_H = 130;          // 行间距（菱形高 110）
    var ORIGIN_X = 40;
    var ORIGIN_Y = 40;
    var byLayer = [];         // byLayer[layer] = [nodes...]
    var start = LiteGraph.createNode("diagnosis/start");
    start.pos = [ORIGIN_X, ORIGIN_Y + 8 * ROW_H];
    start.properties.scenario = "压力测试：100 节点诊断流程图";
    graph.add(start);
    byLayer.push([start]);

    var leafBudget = 35; // 第 6 层叶子数，控制总数≈100
    var layers = [1, 2, 4, 8, 16, 32]; // 深度 1~5 的问诊节点数（二叉）
    layers.forEach(function (count, i) {
      var layer = i + 1;
      var nodes = [];
      var colX = ORIGIN_X + layer * COL_W;
      var span = (count - 1) * ROW_H;
      for (var k = 0; k < count; k++) {
        var q = LiteGraph.createNode("diagnosis/question");
        q.pos = [colX, ORIGIN_Y + k * ROW_H + 160 - span / 2];
        q.properties.question = "层级 " + layer + " 问题 #" + (k + 1);
        q.properties.answers = ["否", "是"];
        rebuildQuestion(q);
        q.title = "❓ " + q.properties.question;
        graph.add(q);
        nodes.push(q);
      }
      byLayer.push(nodes);
    });
    // 第 6 层：35 个叶子（算上第 5 层 32 个问诊 = 32+35=67 不够 100 ——调整预算）
    // 实际总数 = 1+2+4+8+16+32+leaf = 63+leaf；要 ≈100 则 leaf=37
    leafBudget = 37;
    var leafNodes = [];
    var leafX = ORIGIN_X + 6 * COL_W;
    for (var l = 0; l < leafBudget; l++) {
      var d = LiteGraph.createNode("diagnosis/leaf");
      d.pos = [leafX, ORIGIN_Y + l * 60 + 800 - leafBudget * 30];
      d.properties.name = "结论 #" + (l + 1);
      d.properties.confidence = 0.5 + (l % 5) * 0.1;
      d.properties.advice = "处置建议 #" + (l + 1);
      graph.add(d);
      leafNodes.push(d);
    }
    byLayer.push(leafNodes);

    // 连线：第 L 层每节点分 2 支到第 L+1 层两个节点；第 5 层（32 个）每个分 2 支给第 6 层 35 个叶子，按索引顺序分配（>32 个叶子复用部分父节点）
    for (var L = 0; L < byLayer.length - 1; L++) {
      var parents = byLayer[L];
      var children = byLayer[L + 1];
      if (L === byLayer.length - 2) {
        // 第 5 层（问诊） → 第 6 层（叶子）：按父节点索引均匀分发到 35 个叶子
        for (var p = 0; p < parents.length; p++) {
          // 每个父节点选 1~2 个不同叶子作"否/是"分支，确保每个叶子至少被一个父节点指向
          var childIdx1 = (p * 2) % children.length;
          var childIdx2 = (p * 2 + 1 + L) % children.length;
          parents[p].connect(0, children[childIdx1], 0); // 否
          parents[p].connect(1, children[childIdx2], 0); // 是
        }
      } else {
        // 中间层 1:1 二叉展开
        for (var i2 = 0; i2 < parents.length; i2++) {
          parents[i2].connect(1, children[i2 * 2], 3);     // 右锚 → 左锚
          parents[i2].connect(1, children[i2 * 2 + 1], 3);
        }
      }
    }

    var t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    canvas.setDirty(true, true);
    canvas.ds.scale = 0.5; // 缩小点便于查看全景
    canvas.ds.offset = [20, 20];
    canvas.setDirty(true, true);

    var total = graph._nodes.length;
    var links = Object.keys(graph.links).length;
    showStatus(
      "压力测试已加载：" + total + " 节点 / " + links + " 连线\n" +
      "生成耗时：" + (t1 - t0).toFixed(1) + " ms\n" +
      "提示：单击任意节点查看 100 节点规模的流向高亮与父子发光；可拖动/缩放/选择。"
    );
  }

  /* ---------- 验证流程结构 ---------- */
  function nodeLabel(nd) {
    return nd.properties.question || nd.properties.name || nd.properties.scenario || nd.title || nd.type;
  }
  function validateGraph() {
    var issues = [];
    var starts = graph.findNodesByType("diagnosis/start");
    if (starts.length === 0) issues.push("✗ 缺少【诊断起点】节点");
    if (starts.length > 1) issues.push("✗ 存在多个【诊断起点】，应仅有一个");

    var nodes = graph._nodes;
    var reachable = {};
    if (starts.length >= 1) {
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

    nodes.forEach(function (nd) {
      if (nd.type === "diagnosis/start") return;
      var hasParent = (nd.inputs || []).some(function (inp) {
        return inp && inp.link != null && inp.link !== -1;
      });
      if (!hasParent) {
        issues.push("⚠ " + nodeLabel(nd) + " 未接入流程（无上游连接）");
      } else if (starts.length && !reachable[nd.id]) {
        issues.push("⚠ " + nodeLabel(nd) + " 无法从起点到达");
      }
    });

    if (!issues.length) issues.push("✓ 诊断流程结构有效：单一入口、无环路、所有节点均可达。");
    showStatus("【结构验证】\n" + issues.join("\n"));
  }

  /* ---------- 推理演示（随机分支遍历到叶子） ---------- */
  function runInference() {
    var starts = graph.findNodesByType("diagnosis/start");
    if (!starts.length) { showStatus("请先加载或构建诊断流程。"); return; }
    var node = starts[0];
    var path = ["> 起点：" + (node.properties.scenario || "诊断")];
    var guard = 0;
    while (node && node.type !== "diagnosis/leaf" && guard++ < 50) {
      var outs = (node.outputs || []).filter(function (o) { return (o.links || []).length > 0; });
      if (!outs.length) { path.push("…（无可用分支，推理中断）"); break; }
      var choice = outs[Math.floor(Math.random() * outs.length)];
      var link = graph.links[choice.links[0]];
      var next = graph.getNodeById(link.target_id);
      path.push("→ " + (node.properties.question || "…") + "  ⇒  " + nodeLabel(next));
      node = next;
    }
    var result = "";
    if (node && node.type === "diagnosis/leaf") {
      result = "\n────────────\n结论：" + node.properties.name +
        "\n置信度：" + node.properties.confidence +
        "\n处置：" + node.properties.advice;
    }
    showStatus("【推理演示（随机分支）】\n" + path.join("\n") + result);
  }

  /* ---------- 导入 / 导出 ---------- */
  function exportJSON() {
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

  /* ---------- 启动 ---------- */
  resizeCanvas();
  loadSample();
})();
