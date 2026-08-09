import type { Project, Session } from "@workbench/shared";

/** Read-only demo session: analyze a CSV end to end — explore, aggregate,
 *  chart, and write a report with every number traced to the code. */
const exampleAnalysis: Session = {
  id: "example-analysis",
  projectId: "workbench",
  title: "数据分析演示",
  group: "Examples",
  status: "done",
  blocks: [
    { kind: "user", text: "分析我添加的销售数据，找出趋势并生成一份报告" },
    { kind: "step-summary", summary: "完成 5 个步骤", steps: 5, details: ["读取 sales.csv", "清洗缺失值", "按月份聚合", "生成图表", "撰写 report.md"] },
    { kind: "tool-call", title: "运行数据脚本", status: "success", meta: "12s", inputSummary: "sales.csv", outputSummary: "聚合完成，共 24 行" },
    { kind: "agent", markdown: "**要点**\n\n- 3 月销量**环比上升 14%**，为全年峰值。\n- **Q4 整体下降 8%**，与营销预算缩减相关。\n- 完整结论见下方表格与 `report.md`。" },
    { kind: "table", columns: ["月份", "销量", "环比", "备注"], rows: [["3月", "1,240", "+14%", "峰值"], ["6月", "1,180", "-3%", "——"], ["11月", "1,050", "-5%", "预算缩减"]] },
    { kind: "artifact", path: "report.md", filename: "report.md", artifact: "report", tool: "write", language: "markdown" },
  ],
};

/** Read-only demo session: build a small script tool and verify it runs. */
const exampleBuild: Session = {
  id: "example-build",
  projectId: "workbench",
  title: "构建工具演示",
  group: "Examples",
  status: "done",
  blocks: [
    { kind: "user", text: "写一个批量重命名文件的 Python 脚本，把 `IMG_` 前缀改成 `photo-`。" },
    { kind: "tool-call", title: "编写 rename.py", status: "success", shellCommand: "python - <<EOF ...", meta: "3s", outputSummary: "脚本已创建" },
    { kind: "tool-call", title: "试运行 rename.py", status: "success", shellCommand: "python rename.py --dry-run", meta: "2s", outputSummary: "将重命名 12 个文件" },
    { kind: "agent", markdown: "完成。脚本 `rename.py` 已保存并验证，支持 `--dry-run` 预览，可安全批量执行。" },
    { kind: "artifact", path: "rename.py", filename: "rename.py", artifact: "script", tool: "write", content: "import sys\n# ALTER NAME PREFIX\n", language: "python" },
  ],
};

/** Read-only demo session: trace a claim back to the data that produced it. */
const exampleTrace: Session = {
  id: "example-trace",
  projectId: "workbench",
  title: "结论溯源演示",
  group: "Examples",
  status: "done",
  blocks: [
    { kind: "user", text: "帮我核对“大客户流失”这个结论的依据是否站得住。" },
    { kind: "tool-call", title: "运行流失分析", status: "success", meta: "8s", outputSummary: "按客户分组统计续约率" },
    { kind: "table", columns: ["客户", "续约率", "变动", "依据"], rows: [["客户A", "92%", "+3%", "近3个季度"], ["客户B", "41%", "-19%", "Q3 流失"], ["客户C", "78%", "持平", "自动续约"]] },
    { kind: "agent", markdown: "**结论核实**\n\n“大客户流失”主要来自**客户 B 所在行业**（+19% 跌幅），其余客户稳定。建议把结论限定到该行业，而非泛化到全体大客户。" },
    { kind: "artifact", path: "churn.md", filename: "churn.md", artifact: "report", tool: "write", language: "markdown" },
  ],
};

const exampleSessions: Session[] = [
  exampleAnalysis,
  exampleBuild,
  exampleTrace,
];

export const mockProject: Project = {
  id: "workbench",
  name: "Workbench",
  sessions: exampleSessions,
};

export const mockProjects: Project[] = [mockProject];

export function findSession(sessionId: string): Session | undefined {
  return mockProject.sessions.find((s) => s.id === sessionId);
}

export const defaultSessionId = exampleSessions[0].id;