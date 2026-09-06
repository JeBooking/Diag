/* =============================================================
 * diagnosis-nodes.js
 * 基于「诊断专家系统 / 决策树」理论的 LiteGraph 自定义节点
 *
 * 形态设计（无标题栏、空白主体，靠形状+配色区分类型）：
 *   diagnosis/start    诊断起点  —— 胶囊形（青绿）
 *   diagnosis/question 问诊节点  —— 菱形（蓝）
 *   diagnosis/leaf     诊断结论  —— 六边形（橙）
 *
 * 连接模型：每个节点上/下/左/右各一个「通用锚点」，
 * 不区分输入/输出——由用户行为决定：
 *   从 A 锚点按下拖出、连到 B 锚点释放 ⇒ A 为输出、B 为输入。
 * （litegraph 在 mousedown 时先搜输出槽再搜输入槽，锚点处两者重叠，
 *   因此按下永远命中输出槽 = 拖出端；释放端由 isOverNodeInput 命中输入槽。）
 * ============================================================= */
(function (global) {
  "use strict";
  var LiteGraph = global.LiteGraph;

  // 轻量提示（连接被约束拒绝时反馈给用户），由 app.js 提供 PyCharm 风格气泡
  function notify(msg) {
    if (global.DiagFlowUI && typeof global.DiagFlowUI.toast === "function") {
      global.DiagFlowUI.toast(msg, "error");
    }
  }

  /* -----------------------------------------------------------
   * 形状与锚点几何（app.js 的辉光绘制复用 DiagFlowNodes.shapePath）
   * --------------------------------------------------------- */
  var SHAPE_STYLES = {
    "diagnosis/start":    { fill: "#00897b", stroke: "#004d40", anchor: "#e0f2f1" },
    "diagnosis/question": { fill: "#1e88e5", stroke: "#0d47a1", anchor: "#e3f2fd" },
    "diagnosis/leaf":     { fill: "#fb8c00", stroke: "#e65100", anchor: "#fff3e0" }
  };

  // 文本参数（参考亿图图示/draw.io/Visio 流程图节点的内部留白与字号惯例）
  var TEXT_PAD_X = 12;        // 文本左右内边距（菱形/六边形的尖角区不能占）
  var TEXT_LINE = 16;         // 行高（px）
  var TEXT_MAX_LINES = 4;     // 问诊节点最多显示 4 行，超出截断
  var FONT_MAIN = "14px 'Microsoft YaHei', 'PingFang SC', sans-serif";
  var FONT_SUB  = "11px 'Microsoft YaHei', 'PingFang SC', sans-serif";

  // 文本按 maxWidth 自动换行（中文按字符宽度算近似宽度）
  function wrapText(ctx, text, maxWidth) {
    if (!text) return [];
    var lines = [];
    var cur = "";
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      var tentative = cur + c;
      if (ctx.measureText(tentative).width > maxWidth && cur.length > 0) {
        lines.push(cur);
        cur = c;
      } else {
        cur = tentative;
      }
    }
    if (cur.length) lines.push(cur);
    return lines;
  }

  // 绘制节点内文本（垂直水平居中，超出截断加省略号）
  // 返回总占用行高（用于外部布局决策）
  function drawNodeLabel(ctx, text, w, h, font) {
    if (!text) return 0;
    ctx.font = font || FONT_MAIN;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    var maxWidth = Math.max(40, w - TEXT_PAD_X * 2);
    var lines = wrapText(ctx, text, maxWidth);
    if (lines.length > TEXT_MAX_LINES) {
      lines = lines.slice(0, TEXT_MAX_LINES);
      // 最后一行的最后一个字符替换为省略号（若它本身不宽）
      var last = lines[lines.length - 1];
      while (last.length > 1 && ctx.measureText(last + "…").width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = last + "…";
    }
    var total = lines.length * TEXT_LINE;
    var y0 = (h - total) / 2 + 0.5; // 视觉居中微调
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], w * 0.5, y0 + i * TEXT_LINE);
    }
    return total;
  }

  // 节点局部坐标系（0,0 为左上角）下，第 i 个锚点位置：0上 1右 2下 3左
  function anchorLocal(node, slot) {
    var w = node.size[0], h = node.size[1];
    switch (((slot % 4) + 4) % 4) {
      case 0: return [w * 0.5, 0];
      case 1: return [w, h * 0.5];
      case 2: return [w * 0.5, h];
      default: return [0, h * 0.5];
    }
  }

  // 画出节点几何形状路径（x,y 为左上角，绝对或局部坐标均可）
  function shapePath(ctx, type, x, y, w, h) {
    ctx.beginPath();
    if (type === "diagnosis/start") {
      // 胶囊（stadium）：两端半圆
      var r = h / 2;
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, w, h, r);
        return;
      }
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x + r, y + h);
      ctx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
      ctx.closePath();
    } else if (type === "diagnosis/question") {
      // 菱形
      ctx.moveTo(x + w * 0.5, y);
      ctx.lineTo(x + w, y + h * 0.5);
      ctx.lineTo(x + w * 0.5, y + h);
      ctx.lineTo(x, y + h * 0.5);
      ctx.closePath();
    } else {
      // 六边形（左右为尖角）
      ctx.moveTo(x, y + h * 0.5);
      ctx.lineTo(x + w * 0.22, y);
      ctx.lineTo(x + w * 0.78, y);
      ctx.lineTo(x + w, y + h * 0.5);
      ctx.lineTo(x + w * 0.78, y + h);
      ctx.lineTo(x + w * 0.22, y + h);
      ctx.closePath();
    }
  }

  /* -----------------------------------------------------------
   * 连接约束
   * --------------------------------------------------------- */
  function getOutgoingNodes(node) {
    var res = [];
    (node.outputs || []).forEach(function (out) {
      (out.links || []).forEach(function (id) {
        var link = node.graph.links[id];
        if (link) {
          var t = node.graph.getNodeById(link.target_id);
          if (t) res.push(t);
        }
      });
    });
    return res;
  }

  // 从 target 正向遍历，若能到达 source 则说明连上会形成环路
  function wouldCreateCycle(source, target) {
    var seen = {};
    var stack = [target];
    while (stack.length) {
      var cur = stack.pop();
      if (!cur) continue;
      if (cur.id === source.id) return true;
      if (seen[cur.id]) continue;
      seen[cur.id] = true;
      getOutgoingNodes(cur).forEach(function (n) { stack.push(n); });
    }
    return false;
  }

  // source: 拖出端（输出）  target: 释放端（输入）
  function validateLink(source, target, targetSlot) {
    if (!source || !target) return false;
    if (source.id === target.id) return false; // 点锚点原地松手：静默取消，不弹提示

    // 起点只能发出
    if (target.type === "diagnosis/start") {
      notify("诊断起点是流程入口，只能发出连接，不能被连入");
      return false;
    }
    // 结论只能接收
    if (source.type === "diagnosis/leaf") {
      notify("诊断结论是流程终点，只能被连入，不能发出连接");
      return false;
    }

    var input = target.inputs && target.inputs[targetSlot];
    if (!input) return false;

    // 单一父节点：目标任何输入锚点已有连线则拒绝
    var inputs = target.inputs || [];
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i] && inputs[i].link != null && inputs[i].link !== -1) {
        notify("每个节点只能有一个父节点（单一上游）");
        return false;
      }
    }

    // 禁止环路（保持决策树为有向无环图）
    if (wouldCreateCycle(source, target)) {
      notify("不允许形成环路（决策树必须为有向无环图）");
      return false;
    }
    return true;
  }

  /* -----------------------------------------------------------
   * 诊断节点原型公共方法
   * --------------------------------------------------------- */
  function makeDiagnosisProto(proto) {
    // 锚点几何：覆盖默认的垂直槽位布局
    proto.getConnectionPos = function (is_input, slot_number, out) {
      out = out || new Float32Array(2);
      if (this.flags && this.flags.collapsed) {
        out[0] = this.pos[0] + this.size[0] * 0.5;
        out[1] = this.pos[1];
        return out;
      }
      var p = anchorLocal(this, slot_number);
      out[0] = this.pos[0] + p[0];
      out[1] = this.pos[1] + p[1];
      return out;
    };

    // 自绘形状 + 文本 + 锚点（onDrawBackground 时 ctx 已平移到节点局部坐标）
    proto.onDrawBackground = function (ctx, lcanvas) {
      var style = SHAPE_STYLES[this.type] || { fill: "#90a4ae", stroke: "#455a64", anchor: "#eceff1" };
      var w = this.size[0], h = this.size[1];

      shapePath(ctx, this.type, 0, 0, w, h);
      ctx.fillStyle = style.fill;
      ctx.fill();
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 形状内文本（参考亿图图示/draw.io/Visio 流程图节点做法）
      // 三类节点的「主文本字段」由各节点自定义：getLabel(ctx, w, h) 返回 void
      var labelFn = this.getLabel;
      if (typeof labelFn === "function") labelFn.call(this, ctx, w, h);

      // 四个锚点：默认空心小圆；鼠标靠近时放大提示可连接
      for (var i = 0; i < 4; i++) {
        var p = anchorLocal(this, i);
        var r = 4.5;
        if (lcanvas && lcanvas.graph_mouse) {
          var ax = this.pos[0] + p[0], ay = this.pos[1] + p[1];
          var dx = lcanvas.graph_mouse[0] - ax, dy = lcanvas.graph_mouse[1] - ay;
          if (dx * dx + dy * dy < 196) r = 6.5; // 14px 内视为悬停
        }
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        ctx.fillStyle = style.anchor;
        ctx.fill();
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    };

    // 连接约束：从本节点锚点拖出、连到目标节点
    proto.onConnectOutput = function (_slot, _type, _inSlot, target_node, target_slot) {
      return validateLink(this, target_node, target_slot);
    };

    // 只允许锚点对锚点连线：禁掉「拖到节点主体任意位置自动找槽」的兜底
    proto.connectByType = function () { return null; };
    proto.connectByTypeOutput = function () { return null; };

    // 节点命中区域修复：litegraph 的 isPointInside 左/右/上有 ±4px 容差，
    // 但底边是严格不等号（litegraph.js:3942），释放点恰好压在底边锚点时
    // 节点命中失败 → 连不上。统一给命中区域外扩 4px（覆盖锚点外半圈）。
    proto.isPointInside = function (x, y, margin, skip_title) {
      return LiteGraph.LGraphNode.prototype.isPointInside.call(this, x, y, margin || 4, skip_title);
    };
  }

  /* ===========================================================
   * 1) 诊断起点 —— 胶囊
   * ========================================================= */
  function DiagnosisStartNode() {
    LiteGraph.LGraphNode.call(this);
    var self = this;
    ["上", "右", "下", "左"].forEach(function (name) {
      self.addOutput(name, "");
      self.addInput(name, "");
    });
    this.properties = { scenario: "诊断场景描述" };
    this.size = [180, 80];
    this.resizable = false;
  }
  DiagnosisStartNode.title = "诊断起点";
  DiagnosisStartNode.desc = "决策树唯一入口（胶囊形）";
  DiagnosisStartNode.filter = "diagnosis";
  DiagnosisStartNode.title_mode = LiteGraph.NO_TITLE;      // 无标题栏
  DiagnosisStartNode.color = "rgba(0,0,0,0)";              // 隐藏库默认边框色
  DiagnosisStartNode.bgcolor = "rgba(0,0,0,0)";            // 隐藏库默认底色，由自绘接管
  DiagnosisStartNode.prototype.getLabel = function (ctx, w, h) {
    drawNodeLabel(ctx, this.properties.scenario, w, h);
  };
  DiagnosisStartNode.prototype.onDblClick = function () {
    var next = window.prompt("编辑诊断场景（起点描述）：", this.properties.scenario || "");
    if (next !== null) {
      this.properties.scenario = next;
      this.setDirtyCanvas(true, false);
    }
  };
  makeDiagnosisProto(DiagnosisStartNode.prototype);
  LiteGraph.registerNodeType("diagnosis/start", DiagnosisStartNode);

  /* ===========================================================
   * 2) 问诊节点 —— 菱形
   * ========================================================= */
  function DiagnosisQuestionNode() {
    LiteGraph.LGraphNode.call(this);
    var self = this;
    ["上", "右", "下", "左"].forEach(function (name) {
      self.addOutput(name, "");
      self.addInput(name, "");
    });
    this.properties = { question: "请输入判断问题" };
    this.size = [180, 130];
    this.resizable = false;
  }
  DiagnosisQuestionNode.title = "问诊节点";
  DiagnosisQuestionNode.desc = "提出判断问题（菱形）";
  DiagnosisQuestionNode.filter = "diagnosis";
  DiagnosisQuestionNode.title_mode = LiteGraph.NO_TITLE;
  DiagnosisQuestionNode.color = "rgba(0,0,0,0)";
  DiagnosisQuestionNode.bgcolor = "rgba(0,0,0,0)";
  DiagnosisQuestionNode.prototype.getLabel = function (ctx, w, h) {
    // 菱形尖角不能占文字区，额外收窄可绘宽度
    var innerW = Math.max(60, w * 0.72);
    drawNodeLabel(ctx, this.properties.question, innerW, h);
  };
  DiagnosisQuestionNode.prototype.onDblClick = function () {
    var next = window.prompt("编辑判断问题：", this.properties.question || "");
    if (next !== null) {
      this.properties.question = next;
      this.setDirtyCanvas(true, false);
    }
  };
  makeDiagnosisProto(DiagnosisQuestionNode.prototype);
  LiteGraph.registerNodeType("diagnosis/question", DiagnosisQuestionNode);

  /* ===========================================================
   * 3) 诊断结论 —— 六边形
   * ========================================================= */
  function DiagnosisLeafNode() {
    LiteGraph.LGraphNode.call(this);
    var self = this;
    ["上", "右", "下", "左"].forEach(function (name) {
      self.addOutput(name, "");
      self.addInput(name, "");
    });
    this.properties = { name: "诊断结论", confidence: 0.8, advice: "建议的处理方式" };
    this.size = [180, 100];
    this.resizable = false;
  }
  DiagnosisLeafNode.title = "诊断结论";
  DiagnosisLeafNode.desc = "决策树叶子节点（六边形）";
  DiagnosisLeafNode.filter = "diagnosis";
  DiagnosisLeafNode.title_mode = LiteGraph.NO_TITLE;
  DiagnosisLeafNode.color = "rgba(0,0,0,0)";
  DiagnosisLeafNode.bgcolor = "rgba(0,0,0,0)";
  DiagnosisLeafNode.prototype.getLabel = function (ctx, w, h) {
    // 主标题 name + 副标题置信度（六边形左右为尖角，给中间留宽）
    var innerW = Math.max(60, w * 0.78);
    // 主标题垂直居中略偏上，副标题紧贴下方
    var totalMain = drawNodeLabel(ctx, this.properties.name, innerW, h * 0.65);
    var conf = Math.round((this.properties.confidence || 0) * 100);
    ctx.font = FONT_SUB;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    var subY = h * 0.5 + totalMain * 0.25 + 2;
    ctx.fillText("置信度 " + conf + "%", w * 0.5, subY);
  };
  DiagnosisLeafNode.prototype.onDblClick = function () {
    var name = window.prompt("编辑诊断结论（名称）：", this.properties.name || "");
    if (name === null) return;
    this.properties.name = name;
    var confStr = window.prompt("编辑置信度（0~1，例如 0.8）：", String(this.properties.confidence || 0));
    if (confStr !== null) {
      var v = parseFloat(confStr);
      if (!isNaN(v)) this.properties.confidence = Math.max(0, Math.min(1, v));
    }
    var advice = window.prompt("编辑处置建议：", this.properties.advice || "");
    if (advice !== null) this.properties.advice = advice;
    this.setDirtyCanvas(true, false);
  };
  makeDiagnosisProto(DiagnosisLeafNode.prototype);
  LiteGraph.registerNodeType("diagnosis/leaf", DiagnosisLeafNode);

  /* -----------------------------------------------------------
   * 锁定类型外观：诊断节点不允许通过右键菜单改颜色/形状/尺寸等。
   * Collapse 已移除（无标题栏节点无折叠形态）；Clone/Remove 由外层自动追加。
   * --------------------------------------------------------- */
  function lockedMenuOptions() {
    var C = LiteGraph.LGraphCanvas;
    return [
      null,
      { content: "Pin", callback: C.onMenuNodePin },
      null
    ];
  }
  DiagnosisStartNode.prototype.getMenuOptions = lockedMenuOptions;
  DiagnosisQuestionNode.prototype.getMenuOptions = lockedMenuOptions;
  DiagnosisLeafNode.prototype.getMenuOptions = lockedMenuOptions;

  // 导出给外部使用（app.js：辉光沿形状绘制 / 面板提示）
  global.DiagFlowNodes = {
    shapePath: shapePath,
    anchorLocal: anchorLocal,
    SHAPE_STYLES: SHAPE_STYLES
  };
})(window);
