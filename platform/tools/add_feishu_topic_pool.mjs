import fs from "node:fs/promises";

const SECRET_FILE = process.env.FEISHU_CREDENTIALS_FILE || "F:/Codex/.secrets/feishu.env";
const API = "https://open.feishu.cn/open-apis";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) out[match[1].trim()] = match[2].trim();
  }
  return out;
}

const credentials = parseEnv(await fs.readFile(SECRET_FILE, "utf8"));
if (!credentials.FEISHU_APP_ID || !credentials.FEISHU_APP_SECRET) {
  throw new Error("Missing Feishu credentials");
}
const APP_TOKEN = process.env.FEISHU_APP_TOKEN || credentials.FEISHU_APP_TOKEN;
if (!APP_TOKEN) throw new Error("Missing FEISHU_APP_TOKEN");

const tokenResponse = await fetch(`${API}/auth/v3/tenant_access_token/internal`, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ app_id: credentials.FEISHU_APP_ID, app_secret: credentials.FEISHU_APP_SECRET }),
});
const tokenPayload = await tokenResponse.json();
if (tokenPayload.code !== 0) throw new Error(`Feishu auth ${tokenPayload.code}: ${tokenPayload.msg}`);
const token = tokenPayload.tenant_access_token;

async function api(path, { method = "GET", body } = {}) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json();
    if (payload.code === 0) {
      if (method !== "GET") await sleep(350);
      return payload.data ?? {};
    }
    if ([1254290, 1254291, 1254607, 1254608].includes(payload.code) && attempt < 5) {
      await sleep(500 * attempt);
      continue;
    }
    const error = new Error(`${method} ${path} failed ${payload.code}: ${payload.msg}`);
    error.code = payload.code;
    throw error;
  }
}

const text = (field_name, description) => ({ field_name, type: 1, description });
const number = (field_name, description, _ui_type = "Number") => ({ field_name, type: 2, description });
const date = (field_name, description) => ({ field_name, type: 5, description, property: { date_formatter: "yyyy-MM-dd HH:mm" } });
const select = (field_name, options, description) => ({
  field_name,
  type: 3,
  description,
  property: { options: options.map((name) => ({ name })) },
});

const schema = {
  name: "选题池",
  fields: [
    text("抖音链接", "从抖音复制的原始选题链接；一条链接一条记录"),
    text("选题ID", "稳定编号，便于和图书项目、发布记录关联"),
    select("来源平台", ["抖音", "视频号", "小红书", "B站", "其他"], "选题来源平台"),
    text("账号名称", "来源账号或作者名称"),
    text("账号主页", "来源账号主页链接"),
    text("原标题", "来源视频原始标题"),
    text("选题标题", "内部加工后的选题标题"),
    text("内容摘要", "视频讲了什么，先记录事实，不急于改写"),
    text("选题角度", "准备从哪个角度做成读书视频"),
    select("选题类型", ["读书观点", "案例故事", "金句拆解", "热点借势", "产品/课程", "其他"], "选题分类"),
    text("适用图书", "适合关联的书名或项目ID"),
    text("目标账号组", "准备发布到的矩阵账号组"),
    select("选题状态", ["未制作", "待评估", "已入库", "制作中", "待用户确认", "待发布", "已发布", "已归档", "已放弃"], "选题总状态"),
    number("制作进度", "0-100 的制作完成度", "Progress"),
    select("当前步骤", ["未开始", "选题评估", "文案制作", "风格样图", "分镜图片", "配音字幕", "成片审核", "封面确认", "发布", "复盘"], "当前生产步骤"),
    text("当前待确认", "下一件需要用户确认的事情"),
    select("优先级", ["高", "中", "低"], "选题优先级"),
    text("负责人", "当前负责处理的人"),
    date("发现日期", "首次加入选题池的时间"),
    date("计划制作日期", "计划开始制作的时间"),
    text("对应项目ID", "进入图书项目后的项目ID"),
    text("成片路径", "本地审核视频或最终视频路径"),
    text("发布链接", "发布后的平台作品链接"),
    number("浏览量", "发布后的累计浏览量"),
    number("点赞数", "发布后的累计点赞数"),
    number("评论数", "发布后的累计评论数"),
    number("收藏数", "发布后的累计收藏数"),
    number("转发数", "发布后的累计转发数"),
    select("复盘状态", ["未开始", "待复盘", "复盘中", "已完成"], "发布后的复盘状态"),
    text("复盘结论", "数据表现、原因判断和下一次优化"),
    text("备注", "素材来源、版权风险、重复选题等补充信息"),
    date("最近更新", "最近一次状态更新"),
  ],
  views: [
    ["待评估", "grid"],
    ["未制作", "grid"],
    ["制作看板", "kanban"],
    ["待发布", "grid"],
    ["已发布复盘", "grid"],
  ],
};

async function listTables() {
  return (await api(`/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`)).items ?? [];
}

const log = [];
let table = (await listTables()).find((item) => item.name === schema.name);
if (!table) {
  const primary = { ...schema.fields[0] };
  delete primary.description;
  const created = await api(`/bitable/v1/apps/${APP_TOKEN}/tables`, {
    method: "POST",
    body: { table: { name: schema.name, fields: [primary] } },
  });
  table = { table_id: created.table_id, name: schema.name };
  log.push(`Created table ${schema.name}`);
} else {
  log.push(`Existing table kept ${schema.name}`);
}

let fieldItems = (await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields?page_size=100`)).items ?? [];
const existingFields = new Set(fieldItems.map((item) => item.field_name));
for (const field of schema.fields.slice(1)) {
  if (existingFields.has(field.field_name)) continue;
  const payload = { ...field };
  delete payload.description;
  try {
    await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields`, { method: "POST", body: payload });
    log.push(`Added field ${field.field_name}`);
  } catch (error) {
    if (error.code === 1254014) log.push(`Skipped existing field ${field.field_name}`);
    else throw error;
  }
  existingFields.add(field.field_name);
}

const views = (await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/views?page_size=100`)).items ?? [];
const existingViews = new Set(views.map((item) => item.view_name));
for (const [view_name, view_type] of schema.views) {
  if (existingViews.has(view_name)) continue;
  try {
    await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/views`, {
      method: "POST",
      body: { view_name, view_type },
    });
    log.push(`Created view ${view_name}`);
  } catch (error) {
    log.push(`Skipped view ${view_name}: ${error.message}`);
  }
}

const finalFields = (await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields?page_size=100`)).items ?? [];
const finalViews = (await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/views?page_size=100`)).items ?? [];
console.log(JSON.stringify({
  table: { name: table.name, table_id: table.table_id },
  fields: finalFields.map((item) => item.field_name),
  views: finalViews.map((item) => item.view_name),
  records: 0,
  log,
}, null, 2));
