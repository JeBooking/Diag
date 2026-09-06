/* =============================================================
 * diagnosis-nodes.js
 * 基于「诊断专家系统 / 决策树」理论的 LiteGraph 自定义节点
 *
 * 三类节点：
 *   diagnosis/start  诊断起点  —— 决策树唯一入口 (0 输入 / 1 输出)
 *   diagnosis/question 问诊节点 —— 提出判断问题，可动态增减答案分支
 *   diagnosis/leaf   诊断结论  —— 叶子节点，给出结论与处置建议 (1 输入 / 0 输出)
 *
 * 端口类型（用于类型校验与连线高亮）：
 *   entry  起点输出
 *   branch 问诊分支输出
 *   flow   通用输入（接受 entry 或 branch）
 * ============================================================= */
(function (global) {
  "use strict";
  var LiteGraph = global.LiteGraph;

  var TYPE = { ENTRY: "entry", BRANCH: "branch", FLOW: "flow" };

  // 轻量提示（连接被约束拒绝时反馈给用户）
  function notify(msg) {
    if (global.DiagFlowUI && typeof global.DiagFlowUI.toast === "function") {
      global.DiagFlowUI.toast(msg);
    }
  }

  /* -----------------------------------------------------------
   * 端口类型兼容性（被 LiteGraph.isValidConnection 调用）
   * 用于连线时的实时高亮：不兼容的输入槽会变暗
   * --------------------------------------------------------- */
  LiteGraph.isValidConnection = function (type_a, type_b) {
    var outs = [TYPE.ENTRY, TYPE.BRANCH];
    var ins = [TYPE.FLOW];
    var aOut = outs.indexOf(type_a) !== -1;
    var bOut = outs.indexOf(type_b) !== -1;
    var aIn = ins.indexOf(type_a) !== -1;
    var bIn = ins.indexOf(type_b) !== -1;
    // 允许 输出 → 输入 或 反向拖拽 两种方向
    return (aOut && bIn) || (bOut && aIn);
  };

  /* -----------------------------------------------------------
   * 通用连接约束
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

  // source: 源节点(this)  target: 目标节点  targetSlot: 目标输入槽
  function validateLink(source, target, targetSlot) {
    if (!source || !target) return false;
    if (source.id === target.id) { notify("不能连接到自身"); return false; }

    // 起点节点没有输入
    if (target.type === "diagnosis/start") { notify("诊断起点不能作为目标节点"); return false; }

    // 叶子（诊断结论）没有输出，理论上不会成为 source，这里兜底
    if (source.type === "diagnosis/leaf") { notify("诊断结论节点没有输出"); return false; }

    var input = target.inputs[targetSlot];
    if (!input) return false;

    // 单一父节点：输入槽已占用则拒绝（LiteGraph 默认会替换，这里改为强约束）
    if (input.link != null && input.link !== -1 && input.link !== undefined) {
      notify("该节点已有上游连接（决策树节点只接受单一父节点）");
      return false;
    }

    // 类型已在 LiteGraph.isValidConnection 校验；这里兜底再次确认
    if (input.type && input.type !== TYPE.FLOW) { notify("端口类型不匹配"); return false; }

    // 禁止环路（保持决策树为 DAG）
    if (wouldCreateCycle(source, target)) { notify("不允许形成环路（决策树必须为有向无环图）"); return false; }

    return true;
  }

  /* ===========================================================
   * 1) 诊断起点
   * ========================================================= */
  function DiagnosisStartNode(title) {
    LiteGraph.LGraphNode.call(this, title);
    this.addOutput("开始诊断", TYPE.ENTRY);
    this.properties = { scenario: "诊断场景描述" };
    this.size = [220, 70];
    // 类型标识：固定标题与配色，禁止通过右键菜单修改
    this.title = "🚩 诊断起点";
    this.color = "#00695c";   // 标题栏
    this.bgcolor = "#00796b"; // 本体
    this.addWidget("text", "场景", this.properties.scenario, function (v) {
      this.properties.scenario = v;
    });
  }
  DiagnosisStartNode.title = "诊断起点";
  DiagnosisStartNode.desc = "决策树唯一入口：0 输入 / 1 输出";
  DiagnosisStartNode.color = "#00695c";
  DiagnosisStartNode.bgcolor = "#00796b";
  // 菜单过滤标记：配合 canvas.filter = "diagnosis"，右键菜单只显示诊断节点
  DiagnosisStartNode.filter = "diagnosis";
  DiagnosisStartNode.prototype.onConnectOutput = function (slot, _inType, _inSlot, target_node, target_slot) {
    return validateLink(this, target_node, target_slot);
  };
  // 双击编辑：场景描述
  DiagnosisStartNode.prototype.onDblClick = function () {
    var v = window.prompt("编辑诊断场景", this.properties.scenario || "");
    if (v != null) { this.properties.scenario = v; this.setDirtyCanvas(true); }
  };
  LiteGraph.registerNodeType("diagnosis/start", DiagnosisStartNode);

  /* ===========================================================
   * 2) 问诊节点（条件 / 分支）
   * ========================================================= */
  function DiagnosisQuestionNode(title) {
    LiteGraph.LGraphNode.call(this, title);
    this.addInput("前置", TYPE.FLOW);
    this.properties = { question: "请输入判断问题", answers: ["是", "否"] };
    this.size = [250, 130];
    // 类型标识：固定标题与配色，禁止通过右键菜单修改
    this.title = "❓ 问诊节点";
    this.color = "#1565c0";   // 标题栏
    this.bgcolor = "#1e88e5"; // 本体
    var self = this;
    this.addWidget("text", "问题", this.properties.question, function (v) {
      self.properties.question = v;
      self.title = "❓ " + v;
    });
    this.addWidget("button", "＋ 添加选项", null, function () { self.addAnswer(); });
    this.addWidget("button", "－ 删除选项", null, function () { self.removeAnswer(); });
    // 依据 answers 生成分支输出
    this.properties.answers.forEach(function (a, i) {
      self.addOutput(a || ("选项" + (i + 1)), TYPE.BRANCH);
    });
  }
  DiagnosisQuestionNode.title = "问诊节点";
  DiagnosisQuestionNode.desc = "提出判断问题，分支出多个答案（可动态调整）";
  DiagnosisQuestionNode.color = "#1565c0";
  DiagnosisQuestionNode.bgcolor = "#1e88e5";
  DiagnosisQuestionNode.filter = "diagnosis";
  DiagnosisQuestionNode.prototype.addAnswer = function () {
    var n = this.properties.answers.length + 1;
    var name = "选项" + n;
    this.properties.answers.push(name);
    this.addOutput(name, TYPE.BRANCH);
    this.size[1] = Math.max(130, 60 + this.properties.answers.length * 18 + 40);
    this.setDirtyCanvas(true);
  };
  DiagnosisQuestionNode.prototype.removeAnswer = function () {
    if (this.properties.answers.length <= 1) { notify("问诊节点至少保留一个答案分支"); return; }
    this.properties.answers.pop();
    this.removeOutput(this.outputs.length - 1);
    this.size[1] = Math.max(130, 60 + this.properties.answers.length * 18 + 40);
    this.setDirtyCanvas(true);
  };
  DiagnosisQuestionNode.prototype.onConnectOutput = function (slot, _inType, _inSlot, target_node, target_slot) {
    return validateLink(this, target_node, target_slot);
  };
  // 双击编辑：判断问题（答案分支用节点上的 ＋/－ 按钮增减）
  DiagnosisQuestionNode.prototype.onDblClick = function () {
    var q = window.prompt("编辑判断问题", this.properties.question || "");
    if (q != null) { this.properties.question = q; this.title = "❓ " + q; this.setDirtyCanvas(true); }
  };
  LiteGraph.registerNodeType("diagnosis/question", DiagnosisQuestionNode);

  /* -----------------------------------------------------------
   * 关键修复：让自定义诊断节点「整节点可拖拽」
   *
   * 问题：LiteGraph 在 processNodeDown 时会先用 processNodeWidgets 命中控件，
   * 命中即 block_drag_node=true，节点不再进入拖拽。我们的节点带文本/数字控件且
   * 占满主体，导致点主体总被控件吃掉 → 表现为「节点拖不动，只能平移画布」。
   * 内置 basic/* 节点很矮（整块都是标题栏）所以看起来能拖。
   *
   * 修复：对 diagnosis/* 节点，文本/数字类控件不再拦截 mousedown（整节点可拖），
   * 按钮类控件（＋/－ 选项）保留点击。文本编辑改由「双击节点」完成。
   * --------------------------------------------------------- */
  var _origProcessNodeWidgets = LiteGraph.LGraphCanvas.prototype.processNodeWidgets;
  LiteGraph.LGraphCanvas.prototype.processNodeWidgets = function (node, pos, event, active_widget) {
    var isDiag = node && typeof node.type === "string" && node.type.indexOf("diagnosis/") === 0;
    if (!isDiag || !node.widgets || !_origProcessNodeWidgets) {
      return _origProcessNodeWidgets
        ? _origProcessNodeWidgets.call(this, node, pos, event, active_widget)
        : null;
    }

    // 临时屏蔽 text/string/number 控件（原实现遇到 w.disabled 会直接 continue）：
    // 1) 不拦截 mousedown → 节点主体可整体拖拽；
    // 2) 同时避开原实现在 pointerdown 时的副作用（text 弹 prompt、number 直接改值）。
    // button 类控件（＋/－ 选项）保持原样，仍可点击。文本编辑改由「双击节点」完成。
    var masked = [];
    for (var i = 0; i < node.widgets.length; i++) {
      var w = node.widgets[i];
      if (w && (w.type === "text" || w.type === "string" || w.type === "number")) {
        masked.push([w, w.disabled]);
        w.disabled = true;
      }
    }
    var res = _origProcessNodeWidgets.call(this, node, pos, event, active_widget);
    for (var j = 0; j < masked.length; j++) masked[j][0].disabled = masked[j][1];
    return res;
  };

  /* ===========================================================
   * 3) 诊断结论（叶子节点）
   * ========================================================= */
  function DiagnosisLeafNode(title) {
    LiteGraph.LGraphNode.call(this, title);
    this.addInput("依据", TYPE.FLOW);
    this.properties = { name: "诊断结论", confidence: 0.8, advice: "建议的处理方式" };
    this.size = [250, 140];
    // 类型标识：固定标题与配色，禁止通过右键菜单修改
    this.title = "📋 诊断结论";
    this.color = "#bf360c";   // 标题栏
    this.bgcolor = "#e65100"; // 本体
    var self = this;
    this.addWidget("text", "结论", this.properties.name, function (v) { self.properties.name = v; });
    this.addWidget("number", "置信度", this.properties.confidence, function (v) { self.properties.confidence = v; }, { min: 0, max: 1, step: 0.05 });
    this.addWidget("text", "处置建议", this.properties.advice, function (v) { self.properties.advice = v; });
  }
  DiagnosisLeafNode.title = "诊断结论";
  DiagnosisLeafNode.desc = "决策树叶子节点：1 输入 / 0 输出，给出最终结论";
  DiagnosisLeafNode.color = "#bf360c";
  DiagnosisLeafNode.bgcolor = "#e65100";
  DiagnosisLeafNode.filter = "diagnosis";
  // 叶子无输出，onConnectOutput 不会被触发，这里仅作语义占位
  DiagnosisLeafNode.prototype.onConnectOutput = function () { return false; };
  // 双击编辑：结论 / 置信度 / 处置建议
  DiagnosisLeafNode.prototype.onDblClick = function () {
    var name = window.prompt("编辑诊断结论", this.properties.name || "");
    if (name != null) this.properties.name = name;
    var conf = window.prompt("编辑置信度（0–1）", String(this.properties.confidence));
    if (conf != null) { var n = parseFloat(conf); if (!isNaN(n)) this.properties.confidence = Math.max(0, Math.min(1, n)); }
    var advice = window.prompt("编辑处置建议", this.properties.advice || "");
    if (advice != null) this.properties.advice = advice;
    this.setDirtyCanvas(true);
  };
  LiteGraph.registerNodeType("diagnosis/leaf", DiagnosisLeafNode);

  /* -----------------------------------------------------------
   * 锁定类型外观：诊断节点不允许通过右键菜单改颜色 / 形状 / 尺寸等，
   * 保证一眼可辨节点类型。仅保留 折叠 / 固定 / 删除 / 克隆。
   * （getNodeMenuOptions 检测到 node.getMenuOptions 时会用它替换默认菜单，
   *   Colors / Shapes / Resize / Mode / Properties / Title 均被裁掉；
   *   Clone 与 Remove 由外层逻辑自动追加。）
   * --------------------------------------------------------- */
  function lockedMenuOptions() {
    var C = LiteGraph.LGraphCanvas;
    return [
      null,
      { content: "Collapse", callback: C.onMenuNodeCollapse },
      { content: "Pin", callback: C.onMenuNodePin },
      null
    ];
  }
  DiagnosisStartNode.prototype.getMenuOptions = lockedMenuOptions;
  DiagnosisQuestionNode.prototype.getMenuOptions = lockedMenuOptions;
  DiagnosisLeafNode.prototype.getMenuOptions = lockedMenuOptions;

  // 导出给外部使用
  global.DiagFlowNodes = { TYPE: TYPE };
})(window);
