import fs from "node:fs/promises";

const SECRET_FILE = process.env.FEISHU_CREDENTIALS_FILE || "F:/Codex/.secrets/feishu.env";
const API = "https://open.feishu.cn/open-apis";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

const config = parseEnv(await fs.readFile(SECRET_FILE, "utf8"));
if (!config.FEISHU_APP_ID || !config.FEISHU_APP_SECRET) throw new Error("Missing Feishu credentials");
const APP_TOKEN = process.env.FEISHU_APP_TOKEN || config.FEISHU_APP_TOKEN;
if (!APP_TOKEN) throw new Error("Missing FEISHU_APP_TOKEN");
const auth = await fetch(`${API}/auth/v3/tenant_access_token/internal`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: config.FEISHU_APP_ID, app_secret: config.FEISHU_APP_SECRET }),
});
const authJson = await auth.json();
if (authJson.code !== 0) throw new Error(`Auth ${authJson.code}: ${authJson.msg}`);
const token = authJson.tenant_access_token;

async function api(path, { method = "GET", body } = {}) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (data.code === 0) {
      if (method !== "GET") await sleep(350);
      return data.data ?? {};
    }
    if ([1254290, 1254291, 1254607, 1254608].includes(data.code) && attempt < 5) {
      await sleep(500 * attempt);
      continue;
    }
    const error = new Error(`${method} ${path} failed ${data.code}: ${data.msg}`);
    error.code = data.code;
    throw error;
  }
}

const text = (field_name) => ({ field_name, type: 1 });
const number = (field_name) => ({ field_name, type: 2 });
const date = (field_name) => ({ field_name, type: 5, property: { date_formatter: "yyyy-MM-dd HH:mm" } });
const select = (field_name, names) => ({ field_name, type: 3, property: { options: names.map((name) => ({ name })) } });

const log = [];

async function listTables() {
  return (await api(`/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`)).items ?? [];
}

async function ensureFields(table, fields) {
  const listed = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields?page_size=100`);
  const names = new Set((listed.items ?? []).map((x) => x.field_name));
  for (const field of fields) {
    if (!names.has(field.field_name)) {
      try {
        await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields`, { method: "POST", body: field });
        log.push(`Field: ${table.name}.${field.field_name}`);
      } catch (error) {
        if (error.code !== 1254014) throw error;
      }
    }
  }
}

async function ensureTable(schema) {
  let table = (await listTables()).find((x) => x.name === schema.name);
  if (!table) {
    const created = await api(`/bitable/v1/apps/${APP_TOKEN}/tables`, {
      method: "POST", body: { table: { name: schema.name, fields: [schema.fields[0]] } }
    });
    table = { table_id: created.table_id, name: schema.name };
    log.push(`Table: ${schema.name}`);
  }
  await ensureFields(table, schema.fields.slice(1));

  const current = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records?page_size=500`);
  const key = schema.fields[0].field_name;
  const existing = new Set((current.items ?? []).map((x) => x.fields?.[key]).filter(Boolean));
  const missing = (schema.records ?? []).filter((row) => !existing.has(row[key]));
  if (missing.length) {
    await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records/batch_create`, {
      method: "POST", body: { records: missing.map((fields) => ({ fields })) }
    });
    log.push(`Records: ${schema.name} +${missing.length}`);
  }

  const views = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/views?page_size=100`);
  const viewNames = new Set((views.items ?? []).map((x) => x.view_name));
  for (const view of schema.views ?? []) {
    if (!viewNames.has(view.name)) {
      try {
        await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/views`, {
          method: "POST", body: { view_name: view.name, view_type: view.type }
        });
        log.push(`View: ${schema.name}.${view.name}`);
      } catch (error) {
        log.push(`View skipped: ${schema.name}.${view.name} (${error.code ?? error.message})`);
      }
    }
  }
  return table;
}

// Extend the current book-project control table. A new row with a title and blank 项目ID is the intake trigger.
const projectTable = (await listTables()).find((x) => x.name === "图书项目");
if (!projectTable) throw new Error("图书项目 table not found");
await ensureFields(projectTable, [
  select("生产模式", ["标准全流程", "仅生成文案", "矩阵分发"]),
  select("Codex状态", ["待领取", "执行中", "等待用户确认", "已完成", "失败", "已暂停", "已取消"]),
  select("执行指令", ["自动", "继续执行", "重试", "暂停", "取消"]),
  select("任务优先级", ["紧急", "高", "普通", "低"]),
  text("目标账号组"), text("Codex运行ID"), date("Codex最近心跳"), text("Codex错误信息"), text("Obsidian复盘路径")
]);

const projectRecords = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${projectTable.table_id}/records?page_size=100`);
for (const record of projectRecords.items ?? []) {
  const projectId = record.fields?.["项目ID"];
  if (["BK-20260719-001", "BK-20260719-002"].includes(projectId)) {
    await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${projectTable.table_id}/records/${record.record_id}`, {
      method: "PUT",
      body: { fields: {
        "生产模式": "标准全流程", "Codex状态": "等待用户确认", "执行指令": "自动",
        "任务优先级": "普通", "目标账号组": "待配置"
      } }
    });
  }
}

const schemas = [
  {
    name: "Codex任务队列",
    fields: [
      text("任务ID"), text("项目ID"), text("书名"),
      select("任务类型", ["新书接入", "继续生产", "修订文案", "重做样图", "重做配音", "生成成片", "矩阵分发", "数据回收", "生成复盘"]),
      select("任务状态", ["待领取", "执行中", "等待用户确认", "已完成", "失败", "已暂停", "已取消"]),
      text("当前步骤"), select("优先级", ["紧急", "高", "普通", "低"]), text("触发来源"),
      date("创建时间"), date("领取时间"), date("最近心跳"), date("完成时间"), number("重试次数"),
      text("运行ID"), text("输入摘要"), text("输出路径"), text("错误信息"), text("下一步动作")
    ],
    records: [
      {"任务ID":"TASK-BK001-REVIEW","项目ID":"BK-20260719-001","书名":"允许一切发生","任务类型":"继续生产","任务状态":"等待用户确认","当前步骤":"成片与剪映草稿审核","优先级":"普通","触发来源":"已有项目迁移","创建时间":1752940800000,"重试次数":0,"输入摘要":"等待用户审片","输出路径":"work/2026-07-19-allow-everything-01/remix.mp4","错误信息":"","下一步动作":"审片通过后进入发布确认"},
      {"任务ID":"TASK-BK002-SCRIPT","项目ID":"BK-20260719-002","书名":"兜底","任务类型":"继续生产","任务状态":"等待用户确认","当前步骤":"文案确认","优先级":"普通","触发来源":"已有项目迁移","创建时间":1752940800000,"重试次数":0,"输入摘要":"文案 v2 待确认","输出路径":"work/2026-07-19-兜底-01/script.txt","错误信息":"","下一步动作":"确认文案后才能确认样图"}
    ],
    views: [{name:"待执行",type:"grid"},{name:"执行中",type:"grid"},{name:"等待确认",type:"grid"},{name:"任务异常",type:"grid"}]
  },
  {
    name: "矩阵账号",
    fields: [
      text("账号ID"), text("账号名称"), select("平台", ["微信视频号", "抖音", "小红书", "B站", "其他"]),
      text("矩阵分组"), text("账号定位"), text("目标受众"), text("内容支柱"), text("视觉与语气"),
      number("周更目标"), select("账号状态", ["筹备中", "正常运营", "暂停", "封禁", "停用"]), text("负责人"),
      text("账号主页"), select("发布方式", ["人工发布", "平台工具", "第三方工具", "API"]),
      select("数据采集方式", ["手工录入", "Excel导入", "截图识别", "第三方API", "官方API"]),
      text("凭证别名"), number("当前粉丝数"), date("粉丝更新时间"), date("启用日期"), text("备注")
    ],
    records: [],
    views: [{name:"正常运营",type:"grid"},{name:"待配置账号",type:"grid"},{name:"账号看板",type:"kanban"}]
  },
  {
    name: "内容分发",
    fields: [
      text("分发ID"), text("项目ID"), text("书名"), text("账号ID"), text("账号名称"), text("矩阵分组"),
      text("内容版本"), text("账号适配角度"), text("开头钩子"), text("发布标题"), text("封面路径"), text("成片路径"),
      date("计划发布日期"), select("发布状态", ["待分配账号", "待适配", "待审核", "待发布", "已排期", "已发布", "发布失败", "已下架"]),
      date("实际发布日期"), text("平台作品ID"), text("作品链接"), text("发布文案"), select("发布后质检", ["未开始", "通过", "需修订", "失败"]), text("备注")
    ],
    records: [
      {"分发ID":"DIST-BK001-UNASSIGNED","项目ID":"BK-20260719-001","书名":"允许一切发生","账号ID":"待分配","账号名称":"","矩阵分组":"待配置","内容版本":"母版 v1","账号适配角度":"","开头钩子":"","发布标题":"","封面路径":"","成片路径":"work/2026-07-19-allow-everything-01/remix.mp4","发布状态":"待分配账号","平台作品ID":"","作品链接":"","发布文案":"","发布后质检":"未开始","备注":"审片通过后分配账号"},
      {"分发ID":"DIST-BK002-UNASSIGNED","项目ID":"BK-20260719-002","书名":"兜底","账号ID":"待分配","账号名称":"","矩阵分组":"待配置","内容版本":"母版 v2","账号适配角度":"","开头钩子":"","发布标题":"","封面路径":"","成片路径":"","发布状态":"待分配账号","平台作品ID":"","作品链接":"","发布文案":"","发布后质检":"未开始","备注":"文案确认后继续生产"}
    ],
    views: [{name:"待分配账号",type:"grid"},{name:"待发布",type:"grid"},{name:"已发布内容",type:"grid"},{name:"按账号看板",type:"kanban"}]
  },
  {
    name: "数据快照",
    fields: [
      text("快照ID"), text("分发ID"), text("项目ID"), text("账号ID"), text("账号名称"), text("书名"),
      date("采集时间"), number("发布后小时"), number("播放量"), number("独立观众"), number("平均观看秒数"),
      number("完播率%"), number("点赞"), number("评论"), number("转发"), number("收藏"), number("新增关注"),
      number("主页访问"), number("私信线索"), number("成交单量"), number("成交金额"),
      select("数据来源", ["手工录入", "Excel导入", "截图识别", "第三方API", "官方API"]), text("原始数据文件"), text("备注")
    ],
    records: [],
    views: [{name:"近7天",type:"grid"},{name:"按账号",type:"grid"},{name:"按内容",type:"grid"}]
  },
  {
    name: "复盘记录",
    fields: [
      text("复盘ID"), select("复盘类型", ["单条内容", "单账号周报", "矩阵周报", "产品月报", "实验复盘"]),
      date("周期开始"), date("周期结束"), text("对象ID"), text("对象名称"), number("样本数"), number("总播放量"),
      number("平均完播率%"), number("互动率%"), number("关注转化率%"), text("最佳内容"), text("低表现内容"),
      text("有效规律"), text("问题诊断"), text("下一轮假设"), text("下一轮实验"), text("负责人"),
      select("复盘状态", ["待生成", "生成中", "待确认", "已确认", "已归档"]), text("Obsidian路径"), date("创建时间"), text("备注")
    ],
    records: [],
    views: [{name:"待复盘",type:"grid"},{name:"实验库",type:"grid"},{name:"已归档",type:"grid"}]
  }
];

for (const schema of schemas) await ensureTable(schema);

const finalTables = await listTables();
const summary = [];
for (const table of finalTables) {
  const fields = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields?page_size=100`);
  const records = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records?page_size=1`);
  const views = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/views?page_size=100`);
  summary.push({ name: table.name, table_id: table.table_id, fields: fields.items?.length ?? 0, records: records.total ?? 0, views: (views.items ?? []).map((x) => x.view_name) });
}

const report = { completed_at: new Date().toISOString(), log, summary };
await fs.writeFile("E:/BaiduNetdiskWorkspace/电脑其他文件同步/视频号/AI视频/outputs/feishu-pipeline-20260720/feishu-matrix-extension-report.json", JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
