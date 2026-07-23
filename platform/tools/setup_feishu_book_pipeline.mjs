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

const tokenResponse = await fetch(`${API}/auth/v3/tenant_access_token/internal`, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ app_id: config.FEISHU_APP_ID, app_secret: config.FEISHU_APP_SECRET }),
});
const tokenJson = await tokenResponse.json();
if (tokenJson.code !== 0) throw new Error(`Token error ${tokenJson.code}: ${tokenJson.msg}`);
const token = tokenJson.tenant_access_token;

async function api(path, { method = "GET", body } = {}) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
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

const text = (field_name, description) => ({ field_name, type: 1, description });
const number = (field_name, description, ui_type = "Number") => ({ field_name, type: 2, description });
const date = (field_name, description) => ({ field_name, type: 5, description, property: { date_formatter: "yyyy-MM-dd HH:mm" } });
const select = (field_name, options, description) => ({
  field_name,
  type: 3,
  description,
  property: { options: options.map((name) => ({ name })) },
});

const statusOptions = ["待选题", "制作中", "待用户确认", "待修订", "待发布", "已发布", "已归档", "已阻塞"];
const assetStatusOptions = ["未开始", "制作中", "待确认", "需修订", "已完成", "已通过"];
const publishOptions = ["未发布", "待发布", "已排期", "已发布", "发布失败", "已下架"];
const gateOptions = ["未开始", "待确认", "已确认", "已通过", "已完成", "已完成（倒推）", "提前产出待确认", "需修订", "已阻塞"];

const schemas = [
  {
    name: "图书项目",
    defaultView: "生产总控台",
    fields: [
      text("书名", "一本书一条记录，主字段"), text("项目ID", "跨表关联的稳定编号"), text("作者", "作者或译者"),
      text("内容主题", "本条视频的内容主线"),
      select("当前阶段", ["项目初始化","书目与来源核验","文案审核","风格样图审核","背景图与分镜审核","配音与字幕制作","时间轴与混音","成片与草稿审核","发布与归档","流程结束"], "当前所处生产阶段"),
      number("进度", "0-100 的阶段进度", "Progress"), select("工作状态", statusOptions, "项目总状态"),
      text("当前待确认", "下一件需要用户确认的事项"), text("确认负责人", "默认由用户确认"),
      select("文案状态", assetStatusOptions, "script.txt 状态"), select("风格样图状态", assetStatusOptions, "一张样图确认门禁"),
      select("分镜图状态", assetStatusOptions, "分镜表和背景图状态"), select("配音状态", assetStatusOptions, "锁定男声状态"),
      select("字幕状态", assetStatusOptions, "中英单行字幕状态"), select("成片状态", assetStatusOptions, "审核样片状态"),
      select("剪映草稿状态", assetStatusOptions, "新建可编辑草稿状态"), text("质检结果", "PASS 或问题摘要"),
      select("发布状态", publishOptions, "与制作状态分开"), select("发布平台", ["微信视频号","抖音","小红书","B站","其他"], "目标平台"),
      number("成片时长(秒)", "真实成片时长"), text("工作目录", "本地 work 项目路径"), text("成片路径", "审核样片或终稿路径"),
      text("下一步动作", "当前应执行的最小动作"), text("阻塞与风险", "质检失败、缺素材、越门禁等"), date("最近更新", "本地项目最近更新时间"),
      text("数据来源", "用于核验状态的文件")
    ],
    records: [
      {"书名":"允许一切发生","项目ID":"BK-20260719-001","作者":"李梦霁","内容主题":"尊重过往，允许人生松弛地发生","当前阶段":"成片与草稿审核","进度":90,"工作状态":"待用户确认","当前待确认":"审成片与剪映草稿","确认负责人":"用户","文案状态":"已完成","风格样图状态":"已完成","分镜图状态":"已完成","配音状态":"已完成","字幕状态":"已完成","成片状态":"待确认","剪映草稿状态":"已通过","质检结果":"PASS","发布状态":"未发布","发布平台":"微信视频号","成片时长(秒)":54,"工作目录":"E:/BaiduNetdiskWorkspace/电脑其他文件同步/视频号/AI视频/work/2026-07-19-allow-everything-01","成片路径":"E:/BaiduNetdiskWorkspace/电脑其他文件同步/视频号/AI视频/work/2026-07-19-allow-everything-01/remix.mp4","下一步动作":"用户审片；通过后进入发布确认","阻塞与风险":"早期文案与样图确认缺少独立记录，目前由下游产出倒推","最近更新":1752949168000,"数据来源":"delivery-manifest.json；draft_check_report.md；script_sources.md"},
      {"书名":"兜底","项目ID":"BK-20260719-002","作者":"晴山","内容主题":"能力在行动中生长，为自己的人生兜底","当前阶段":"文案审核","进度":25,"工作状态":"待用户确认","当前待确认":"确认文案 v2","确认负责人":"用户","文案状态":"待确认","风格样图状态":"待确认","分镜图状态":"待确认","配音状态":"未开始","字幕状态":"未开始","成片状态":"未开始","剪映草稿状态":"未开始","质检结果":"未开始","发布状态":"未发布","发布平台":"微信视频号","工作目录":"E:/BaiduNetdiskWorkspace/电脑其他文件同步/视频号/AI视频/work/2026-07-19-兜底-01","成片路径":"","下一步动作":"先确认 script.txt；未确认前停止配音和后续制作","阻塞与风险":"文案未确认却已生成样图和 9 张分镜图，属于越过门禁","最近更新":1752949168000,"数据来源":"script_sources.md；storyboard.json；storyboard/images/"}
    ],
    extraViews: [{name:"待我确认",type:"grid"},{name:"制作看板",type:"kanban"},{name:"异常与阻塞",type:"grid"},{name:"已发布归档",type:"grid"}]
  },
  {
    name: "确认节点", defaultView: "全部门禁",
    fields: [text("节点ID","唯一编号"),text("项目ID","对应图书项目"),text("书名","便于直接查看"),number("顺序","门禁顺序"),text("确认节点","节点名称"),select("节点类型",["用户确认","系统质检","系统记录"],"谁负责判断"),select("是否强制",["是","否"],"是否阻止下游"),select("节点状态",gateOptions,"门禁状态"),text("负责人","用户或系统"),text("证据与文件","判断依据"),text("下一阶段","通过后的阶段"),text("备注","例外和风险")],
    records: [], extraViews: [{name:"待确认节点",type:"grid"},{name:"异常节点",type:"grid"}]
  },
  {
    name: "发布记录", defaultView: "全部发布",
    fields: [text("发布ID","唯一编号"),text("项目ID","对应图书项目"),text("书名","作品书名"),select("平台",["微信视频号","抖音","小红书","B站","其他"],"发布平台"),text("账号","发布账号"),select("发布状态",publishOptions,"发布生命周期"),date("计划日期","计划发布时间"),date("实际日期","实际发布时间"),text("作品链接","发布后的链接"),text("标题与文案","平台发布文案"),text("成片路径","本地成片"),select("发布后质检",["未开始","通过","需修订","失败"],"链接、画质、声音检查"),select("数据回收状态",["未开始","待回收","已回收"],"发布后数据"),text("备注","补充信息")],
    records: [
      {"发布ID":"PUB-20260719-001","项目ID":"BK-20260719-001","书名":"允许一切发生","平台":"微信视频号","账号":"","发布状态":"未发布","作品链接":"","标题与文案":"","成片路径":"E:/BaiduNetdiskWorkspace/电脑其他文件同步/视频号/AI视频/work/2026-07-19-allow-everything-01/remix.mp4","发布后质检":"未开始","数据回收状态":"未开始","备注":"等待用户审片"},
      {"发布ID":"PUB-20260719-002","项目ID":"BK-20260719-002","书名":"兜底","平台":"微信视频号","账号":"","发布状态":"未发布","作品链接":"","标题与文案":"","成片路径":"","发布后质检":"未开始","数据回收状态":"未开始","备注":"仍在文案确认门禁"}
    ], extraViews: [{name:"发布日历",type:"calendar"},{name:"待发布",type:"grid"}]
  },
  {
    name: "公共资产", defaultView: "资产状态",
    fields: [text("资产名称","公共依赖"),text("资产ID","唯一编号"),select("资产类型",["视频","音频","配置"],"文件类型"),text("固定路径","本地路径"),select("当前状态",["可用","缺失","待验证","需更新"],"健康状态"),text("关键参数","固定参数"),text("影响范围","下游用途"),date("最近检查","检查日期")],
    records: [
      {"资产名称":"前3秒固定开头","资产ID":"AST-001","资产类型":"视频","固定路径":"E:/BaiduNetdiskWorkspace/电脑其他文件同步/视频号/AI视频/固定/前3秒固定开头.mp4","当前状态":"可用","关键参数":"保留原始音频","影响范围":"所有成片开头","最近检查":1752940800000},
      {"资产名称":"背景音乐","资产ID":"AST-002","资产类型":"音频","固定路径":"E:/BaiduNetdiskWorkspace/电脑其他文件同步/视频号/AI视频/固定/背景音乐.mp3","当前状态":"可用","关键参数":"基线音量 0.63；结尾淡出 1 秒","影响范围":"所有成片混音","最近检查":1752940800000},
      {"资产名称":"锁定男声预设","资产ID":"AST-003","资产类型":"配置","固定路径":"E:/BaiduNetdiskWorkspace/电脑其他文件同步/视频号/AI视频/assets/voice-presets/male-podcast-locked-v1.json","当前状态":"可用","关键参数":"VoxCPM2；CFG 2.0；steps 20；seed 42","影响范围":"所有男声旁白","最近检查":1752940800000},
      {"资产名称":"锁定男声参考音色","资产ID":"AST-004","资产类型":"音频","固定路径":"E:/BaiduNetdiskWorkspace/电脑其他文件同步/视频号/AI视频/assets/voice-presets/male-podcast-locked-v1-reference.wav","当前状态":"可用","关键参数":"不得自行更换","影响范围":"旁白音色","最近检查":1752940800000},
      {"资产名称":"锁定男声金标准","资产ID":"AST-005","资产类型":"音频","固定路径":"E:/BaiduNetdiskWorkspace/电脑其他文件同步/视频号/AI视频/assets/voice-presets/male-podcast-locked-v1-full.wav","当前状态":"可用","关键参数":"成品音色与音调比对基准","影响范围":"旁白质检","最近检查":1752940800000}
    ], extraViews: []
  },
  {
    name: "状态字典", defaultView: "阶段与选项",
    fields: [text("当前阶段","阶段名称"),number("进度权重","0-100"),text("阶段出口条件","进入下一步的必要条件"),text("确认性质","用户确认或系统质检")],
    records: [
      {"当前阶段":"项目初始化","进度权重":5,"阶段出口条件":"目录和公共资产可用","确认性质":"系统质检"},
      {"当前阶段":"书目与来源核验","进度权重":15,"阶段出口条件":"书名、作者、观点、引用已核对","确认性质":"系统质检"},
      {"当前阶段":"文案审核","进度权重":25,"阶段出口条件":"用户确认 script.txt","确认性质":"用户确认"},
      {"当前阶段":"风格样图审核","进度权重":35,"阶段出口条件":"用户确认一张风格样图","确认性质":"用户确认"},
      {"当前阶段":"背景图与分镜审核","进度权重":50,"阶段出口条件":"每个镜头语义对应且用户确认","确认性质":"用户确认"},
      {"当前阶段":"配音与字幕制作","进度权重":65,"阶段出口条件":"锁定男声与双语单行字幕通过","确认性质":"系统质检"},
      {"当前阶段":"时间轴与混音","进度权重":78,"阶段出口条件":"按真实配音时长对齐","确认性质":"系统质检"},
      {"当前阶段":"成片与草稿审核","进度权重":90,"阶段出口条件":"成片、草稿和质检报告待用户审核","确认性质":"用户确认"},
      {"当前阶段":"发布与归档","进度权重":100,"阶段出口条件":"发布完成并明确批准归档","确认性质":"用户确认"},
      {"当前阶段":"流程结束","进度权重":100,"阶段出口条件":"已发布且迁移到 final/","确认性质":"系统记录"}
    ], extraViews: []
  }
];

const gateDefinitions = [
  [1,"书目信息与引用核验","系统质检","研究完成"],[2,"文案确认","用户确认","生成分镜"],[3,"风格样图确认","用户确认","批量生成背景图"],[4,"背景图与分镜审核","用户确认","生成配音"],[5,"配音字幕与技术质检","系统质检","生成成片与草稿"],[6,"成片与剪映草稿审核","用户确认","安排发布"],[7,"发布确认","用户确认","正式发布"],[8,"发布结果与归档","系统记录","流程结束"]
];
const allowGateStatus = [
  ["已通过","系统","script_sources.md","来源与书目信息已记录"],["已完成（倒推）","用户","script.txt","缺独立确认记录"],["已完成（倒推）","用户","storyboard/images/","缺独立确认记录"],["已完成","用户","storyboard/image-validation.md","已有 12 个正式镜头"],["已通过","系统","voice/voice-validation.md；字幕文件","配音与双语字幕已完成"],["待确认","用户","remix.mp4；jianying_draft/draft_check_report.md","草稿质检 PASS，等待实际审片"],["未开始","用户","","审片通过后才能发布"],["未开始","系统","final/","当前 final/ 为空"]
];
const fallbackGateStatus = [
  ["已通过","系统","script_sources.md","书名、作者、ISBN、微信读书来源已核验"],["待确认","用户","script.txt","来源记录明确写明 v2 待用户审核"],["提前产出待确认","用户","storyboard/images/style-sample-01.png；style-sample-02.png","应在文案确认后再确认样图"],["提前产出待确认","用户","storyboard/storyboard.json；9 张分镜图","已越过门禁，不应继续配音"],["未开始","系统","","等待前置门禁"],["未开始","用户","","等待前置门禁"],["未开始","用户","","等待前置门禁"],["未开始","系统","final/","等待发布"]
];
function buildGates(projectId, book, prefix, states) {
  return gateDefinitions.map((g, i) => ({
    "节点ID": `${prefix}-G${String(i + 1).padStart(2, "0")}`, "项目ID": projectId, "书名": book,
    "顺序": g[0], "确认节点": g[1], "节点类型": g[2], "是否强制": "是", "节点状态": states[i][0],
    "负责人": states[i][1], "证据与文件": states[i][2], "下一阶段": g[3], "备注": states[i][3]
  }));
}
schemas.find((s) => s.name === "确认节点").records = [
  ...buildGates("BK-20260719-001", "允许一切发生", "BK001", allowGateStatus),
  ...buildGates("BK-20260719-002", "兜底", "BK002", fallbackGateStatus)
];

const log = [];
await api(`/bitable/v1/apps/${APP_TOKEN}`, { method: "PUT", body: { name: "图书视频生产线" } });
log.push("Base renamed: 图书视频生产线");

async function listTables() {
  const result = await api(`/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`);
  return result.items ?? [];
}

async function ensureTable(schema) {
  let tables = await listTables();
  let table = tables.find((x) => x.name === schema.name);
  if (!table) {
    const primaryPayload = { ...schema.fields[0] };
    delete primaryPayload.description;
    const created = await api(`/bitable/v1/apps/${APP_TOKEN}/tables`, {
      method: "POST",
      body: { table: { name: schema.name, fields: [primaryPayload] } },
    });
    table = { table_id: created.table_id, name: schema.name };
    log.push(`Created table: ${schema.name}`);
  } else {
    log.push(`Existing table kept: ${schema.name}`);
  }

  let fieldsResult = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields?page_size=100`);
  let fieldItems = fieldsResult.items ?? [];
  const primaryName = schema.fields[0].field_name;
  const primary = fieldItems.find((x) => x.is_primary);
  if (primary && primary.field_name !== primaryName) {
    const primaryPayload = { ...schema.fields[0] };
    delete primaryPayload.description;
    await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields/${primary.field_id}`, { method: "PUT", body: primaryPayload });
    log.push(`Renamed primary field: ${schema.name}.${primaryName}`);
    fieldsResult = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields?page_size=100`);
    fieldItems = fieldsResult.items ?? [];
  }
  const existingNames = new Set(fieldItems.map((x) => x.field_name));
  for (const field of schema.fields.slice(1)) {
    if (!existingNames.has(field.field_name)) {
      const payload = { ...field };
      delete payload.description;
      try {
        await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields`, { method: "POST", body: payload });
        log.push(`Added field: ${schema.name}.${field.field_name}`);
      } catch (error) {
        if (error.code === 1254014) log.push(`Field already exists: ${schema.name}.${field.field_name}`);
        else throw error;
      }
    }
  }

  const recordsResult = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records?page_size=500`);
  const existingKeys = new Set((recordsResult.items ?? []).map((r) => {
    const primary = schema.fields[0].field_name;
    return r.fields?.[primary];
  }).filter(Boolean));
  const missing = schema.records.filter((row) => !existingKeys.has(row[schema.fields[0].field_name]));
  if (missing.length) {
    await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records/batch_create`, {
      method: "POST", body: { records: missing.map((fields) => ({ fields })) }
    });
    log.push(`Inserted records: ${schema.name} +${missing.length}`);
  }

  const viewsResult = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/views?page_size=100`);
  const viewNames = new Set((viewsResult.items ?? []).map((x) => x.view_name));
  for (const view of schema.extraViews) {
    if (!viewNames.has(view.name)) {
      try {
        await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/views`, {
          method: "POST", body: { view_name: view.name, view_type: view.type }
        });
        log.push(`Created view: ${schema.name}.${view.name}`);
      } catch (error) {
        log.push(`View skipped: ${schema.name}.${view.name} (${error.message})`);
      }
    }
  }
  return table;
}

for (const schema of schemas) await ensureTable(schema);

const finalTables = await listTables();
const summary = [];
for (const table of finalTables) {
  const fields = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields?page_size=100`);
  const records = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records?page_size=1`);
  const views = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/views?page_size=100`);
  summary.push({ name: table.name, table_id: table.table_id, fields: fields.items?.length ?? 0, records: records.total ?? 0, views: views.items?.map((v) => v.view_name) ?? [] });
}

const report = { app_token: APP_TOKEN, completed_at: new Date().toISOString(), log, summary };
await fs.writeFile("E:/BaiduNetdiskWorkspace/电脑其他文件同步/视频号/AI视频/outputs/feishu-pipeline-20260720/feishu-sync-report.json", JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
