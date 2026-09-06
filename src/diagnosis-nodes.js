/* =============================================================
 * diagnosis-nodes.js
 * 基于「诊断专家系统 / 决策树」理论的 LiteGraph 自定义节点
 *
 * 节点体系（8 种，按故障排查闭环设计）：
 *   diagnosis/start      诊断起点   —— 胶囊     （青绿）  流程唯一入口
 *   diagnosis/diag       诊断节点   —— 圆角矩形 （青绿）  呈现排查数据，不改机台状态
 *   diagnosis/action     诊断动作   —— 圆角矩形 （蓝）    执行机台动作，推动诊断继续
 *   diagnosis/conclusion 结论节点   —— 菱形     （橙）    排查得出的结论（可初步）
 *   diagnosis/measure    措施节点   —— 矩形     （紫）    结论之后执行什么措施
 *   diagnosis/resolved   问题解决   —— 胶囊     （绿）    诊断+措施后问题是否解决
 *   diagnosis/escalate   上升       —— 梯形     （红）    缺方向/缺手段，或措施无效后上升
 *   diagnosis/continue   继续活动   —— 圆角矩形 （灰蓝）  问题解决后走向继续活动（固定文本）
 *
 * 形态设计（无标题栏、空白主体，靠形状+配色区分类型）：
 *   内部留白，仅一个可编辑文本字段 + 上/右/下/左四个「通用锚点」。
 *
 * 连接模型：每个锚点不区分输入/输出——由用户行为决定：
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
   * 节点元信息集中表：type → { title, shape, fill, stroke, anchor, size, textField }
   * shape 取值：capsule / roundrect / diamond / rect / trapezoid
   * --------------------------------------------------------- */
  var NODE_DEFS = {
    "diagnosis/start": {
      title: "诊断起点", shape: "capsule",
      fill: "#00897b", stroke: "#004d40", anchor: "#e0f2f1",
      size: [180, 80], textField: "scenario", defaultText: "诊断场景描述"
    },
    "diagnosis/diag": {
      title: "诊断节点", shape: "roundrect",
      fill: "#26a69a", stroke: "#00695c", anchor: "#e0f2f1",
      size: [190, 100], textField: "data", defaultText: "需要排查的现象"
    },
    "diagnosis/action": {
      title: "诊断动作", shape: "roundrect",
      fill: "#1e88e5", stroke: "#0d47a1", anchor: "#e3f2fd",
      size: [190, 100], textField: "action", defaultText: "执行的动作", extraField: "followup", extraDefault: "后续动作"
    },
    "diagnosis/conclusion": {
      title: "结论节点", shape: "diamond",
      fill: "#fb8c00", stroke: "#e65100", anchor: "#fff3e0",
      size: [180, 130], textField: "conclusion", defaultText: "排查结论"
    },
    "diagnosis/measure": {
      title: "措施节点", shape: "rect",
      fill: "#8e24aa", stroke: "#4a148c", anchor: "#f3e5f5",
      size: [180, 90], textField: "measure", defaultText: "执行的措施"
    },
    "diagnosis/resolved": {
      title: "问题解决", shape: "capsule",
      fill: "#43a047", stroke: "#1b5e20", anchor: "#e8f5e9",
      size: [180, 80], textField: "judgement", defaultText: "问题是否解决"
    },
    "diagnosis/escalate": {
      title: "上升", shape: "trapezoid",
      fill: "#e53935", stroke: "#b71c1c", anchor: "#ffebee",
      size: [180, 90], textField: "reason", defaultText: "上升原因"
    },
    "diagnosis/continue": {
      title: "继续活动", shape: "roundrect",
      fill: "#546e7a", stroke: "#263238", anchor: "#eceff1",
      size: [180, 80], textField: null, defaultText: null, fixedText: "继续活动"
    }
  };

  // 文本参数（参考亿图图示/draw.io/Visio 流程图节点的内部留白与字号惯例）
  var TEXT_PAD_X = 12;        // 文本左右内边距（菱形/梯形的尖角区不能占）
  var TEXT_LINE = 16;         // 行高（px）
  var TEXT_MAX_LINES = 4;     // 最多显示 4 行，超出截断
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
      var last = lines[lines.length - 1];
      while (last.length > 1 && ctx.measureText(last + "…").width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = last + "…";
    }
    var total = lines.length * TEXT_LINE;
    var y0 = (h - total) / 2 + 0.5;
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
    var def = NODE_DEFS[type] || {};
    var shape = def.shape || "roundrect";
    ctx.beginPath();
    if (shape === "capsule") {
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
    } else if (shape === "diamond") {
      ctx.moveTo(x + w * 0.5, y);
      ctx.lineTo(x + w, y + h * 0.5);
      ctx.lineTo(x + w * 0.5, y + h);
      ctx.lineTo(x, y + h * 0.5);
      ctx.closePath();
    } else if (shape === "trapezoid") {
      // 上窄下宽的梯形（上升：由窄走向宽的语义）
      var inset = w * 0.2;
      ctx.moveTo(x + inset, y);
      ctx.lineTo(x + w - inset, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
    } else if (shape === "rect") {
      ctx.rect(x, y, w, h);
    } else {
      // roundrect（默认）
      var rr = Math.min(10, w * 0.08, h * 0.2);
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, w, h, rr);
        return;
      }
      ctx.moveTo(x + rr, y);
      ctx.lineTo(x + w - rr, y);
      ctx.arcTo(x + w, y, x + w, y + rr, rr);
      ctx.lineTo(x + w, y + h - rr);
      ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
      ctx.lineTo(x + rr, y + h);
      ctx.arcTo(x, y + h, x, y + h - rr, rr);
      ctx.lineTo(x, y + rr);
      ctx.arcTo(x, y, x + rr, y, rr);
      ctx.closePath();
    }
  }

  /* -----------------------------------------------------------
   * 连接约束
   *
   * 每个节点「可后接」的目标类型集合（source 输出 → 允许的 target）：
   *   start      → diag / action
   *   diag       → diag / action / conclusion / resolved / escalate   （不能接 measure）
   *   action     → diag / action / conclusion / resolved / escalate   （不能接 measure）
   *   conclusion → measure                                             （只能接措施）
   *   measure    → resolved                                            （只能接问题解决）
   *   resolved   → continue / escalate                                 （解决→继续，未解决→上升）
   *   escalate   → （终止，无输出）
   *   continue   → （终止，无输出）
   *
   * 反向推导的「前接」限制（target 允许的来源）：
   *   conclusion ← diag / action      （结论定义写"只能接诊断节点"，但诊断动作也
   *                                     明确允许后接结论，此处取并集以自洽）
   *   measure    ← conclusion
   *   continue   ← resolved
   *   escalate   ← diag / action / resolved
   * --------------------------------------------------------- */
  var ALLOWED_NEXT = {
    "diagnosis/start":      ["diagnosis/diag", "diagnosis/action"],
    "diagnosis/diag":       ["diagnosis/diag", "diagnosis/action", "diagnosis/conclusion", "diagnosis/resolved", "diagnosis/escalate"],
    "diagnosis/action":     ["diagnosis/diag", "diagnosis/action", "diagnosis/conclusion", "diagnosis/resolved", "diagnosis/escalate"],
    "diagnosis/conclusion": ["diagnosis/measure"],
    "diagnosis/measure":    ["diagnosis/resolved"],
    "diagnosis/resolved":   ["diagnosis/continue", "diagnosis/escalate"],
    "diagnosis/escalate":   [],
    "diagnosis/continue":   []
  };

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

    // 禁止环路（决策树必须为有向无环图）
    if (wouldCreateCycle(source, target)) {
      notify("不允许形成环路（决策树必须为有向无环图）");
      return false;
    }

    // 类型约束：source 可后接的目标集合是否包含 target 类型
    var allowed = ALLOWED_NEXT[source.type];
    if (allowed && allowed.indexOf(target.type) === -1) {
      var st = NODE_DEFS[source.type] || { title: source.type };
      var tt = NODE_DEFS[target.type] || { title: target.type };
      notify("「" + st.title + "」不能直接连接「" + tt.title + "」");
      return false;
    }
    return true;
  }

  /* -----------------------------------------------------------
   * 诊断节点原型公共方法
   * --------------------------------------------------------- */
  function makeDiagnosisProto(proto) {
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

    proto.onDrawBackground = function (ctx, lcanvas) {
      var def = NODE_DEFS[this.type] || { fill: "#90a4ae", stroke: "#455a64", anchor: "#eceff1" };
      var w = this.size[0], h = this.size[1];

      shapePath(ctx, this.type, 0, 0, w, h);
      ctx.fillStyle = def.fill;
      ctx.fill();
      ctx.strokeStyle = def.stroke;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 形状内文本
      var labelFn = this.getLabel;
      if (typeof labelFn === "function") labelFn.call(this, ctx, w, h);

      // 四个锚点
      for (var i = 0; i < 4; i++) {
        var p = anchorLocal(this, i);
        var r = 4.5;
        if (lcanvas && lcanvas.graph_mouse) {
          var ax = this.pos[0] + p[0], ay = this.pos[1] + p[1];
          var dx = lcanvas.graph_mouse[0] - ax, dy = lcanvas.graph_mouse[1] - ay;
          if (dx * dx + dy * dy < 196) r = 6.5;
        }
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        ctx.fillStyle = def.anchor;
        ctx.fill();
        ctx.strokeStyle = def.stroke;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    };

    proto.onConnectOutput = function (_slot, _type, _inSlot, target_node, target_slot) {
      return validateLink(this, target_node, target_slot);
    };

    // 只允许锚点对锚点连线：禁掉「拖到节点主体任意位置自动找槽」的兜底
    proto.connectByType = function () { return null; };
    proto.connectByTypeOutput = function () { return null; };

    proto.isPointInside = function (x, y, margin, skip_title) {
      return LiteGraph.LGraphNode.prototype.isPointInside.call(this, x, y, margin || 4, skip_title);
    };
  }

  /* -----------------------------------------------------------
   * 节点工厂：按 NODE_DEFS 元信息批量生成构造函数并注册
   * --------------------------------------------------------- */
  function buildNodeFactory(type, def) {
    function Node() {
      LiteGraph.LGraphNode.call(this);
      var self = this;
      ["上", "右", "下", "左"].forEach(function (name) {
        self.addOutput(name, "");
        self.addInput(name, "");
      });
      this.properties = {};
      if (def.textField) this.properties[def.textField] = def.defaultText;
      if (def.extraField) this.properties[def.extraField] = def.extraDefault;
      this.size = def.size.slice();
      this.resizable = false;
    }

    Node.title = def.title;
    Node.desc = def.title + "（" + def.shape + "）";
    Node.filter = "diagnosis";
    Node.title_mode = LiteGraph.NO_TITLE;
    Node.color = "rgba(0,0,0,0)";
    Node.bgcolor = "rgba(0,0,0,0)";

    // 文本绘制：固定文本 或 主字段 或 主字段+副字段（诊断动作）
    Node.prototype.getLabel = function (ctx, w, h) {
      if (def.fixedText) {
        drawNodeLabel(ctx, def.fixedText, w, h);
        return;
      }
      var text = this.properties[def.textField];
      if (def.extraField && this.properties[def.extraField]) {
        // 主字段居上，副字段（后续动作）居下，用小字号淡色
        var mainLines = drawNodeLabel(ctx, text, w, h * 0.55);
        ctx.font = FONT_SUB;
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        var subY = h * 0.5 + mainLines * 0.2 + 2;
        ctx.fillText(this.properties[def.extraField], w * 0.5, subY);
        return;
      }
      drawNodeLabel(ctx, text, w, h);
    };

    // 双击编辑文本（参考 draw.io/亿图图示的文本编辑交互）
    Node.prototype.onDblClick = function () {
      var def2 = NODE_DEFS[this.type];
      if (!def2.textField) return; // 固定文本节点（继续活动）不可编辑
      var label = def2.title;
      var next = window.prompt("编辑" + label + "文本：", this.properties[def2.textField] || "");
      if (next !== null) {
        this.properties[def2.textField] = next;
        this.setDirtyCanvas(true, false);
      }
      // 诊断动作额外编辑「后续动作」
      if (def2.extraField) {
        var follow = window.prompt("编辑「后续动作」（会持久传递到后续诊断链路）：", this.properties[def2.extraField] || "");
        if (follow !== null) {
          this.properties[def2.extraField] = follow;
          this.setDirtyCanvas(true, false);
        }
      }
    };

    makeDiagnosisProto(Node.prototype);

    // 锁定类型外观：诊断节点不允许通过右键菜单改颜色/形状/尺寸
    Node.prototype.getMenuOptions = function () {
      var C = LiteGraph.LGraphCanvas;
      return [
        null,
        { content: "Pin", callback: C.onMenuNodePin },
        null
      ];
    };

    return Node;
  }

  // 依次构建并注册 8 种节点
  var NodeConstructors = {};
  Object.keys(NODE_DEFS).forEach(function (type) {
    var def = NODE_DEFS[type];
    var Ctor = buildNodeFactory(type, def);
    NodeConstructors[type] = Ctor;
    LiteGraph.registerNodeType(type, Ctor);
  });

  // 导出给外部使用（app.js：辉光沿形状绘制 / 类型列表 / 全局校验）
  global.DiagFlowNodes = {
    shapePath: shapePath,
    anchorLocal: anchorLocal,
    SHAPE_STYLES: NODE_DEFS,
    NODE_DEFS: NODE_DEFS,
    ALLOWED_NEXT: ALLOWED_NEXT,
    types: Object.keys(NODE_DEFS)
  };
})(window);
