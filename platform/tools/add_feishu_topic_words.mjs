import fs from "node:fs/promises";

const SECRET_FILE = process.env.FEISHU_CREDENTIALS_FILE || "F:/Codex/.secrets/feishu.env";
const API = "https://open.feishu.cn/open-apis";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) result[match[1].trim()] = match[2].trim();
  }
  return result;
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
const number = (field_name, description) => ({ field_name, type: 2, description });
const date = (field_name, description) => ({ field_name, type: 5, description, property: { date_formatter: "yyyy-MM-dd HH:mm" } });
const select = (field_name, options, description) => ({
  field_name,
  type: 3,
  description,
  property: { options: options.map((name) => ({ name })) },
});

const fields = [
  text("选题词", "你可以粘贴选题词、标题或一句话想法"),
  text("抖音链接", "可直接粘贴抖音原始链接"),
  text("原标题", "来源视频标题"),
  text("来源账号", "抖音账号或作者"),
  text("内容摘要", "这个选题讲什么"),
  select("选题状态", ["未制作", "制作中", "待确认", "已完成", "已发布", "已归档", "已放弃"], "由 Codex 更新的制作状态"),
  number("制作进度", "0-100 的制作进度"),
  select("当前步骤", ["未开始", "选题评估", "文案制作", "风格样图", "分镜图片", "配音字幕", "成片审核", "封面确认", "发布", "复盘"], "当前生产步骤"),
  text("当前待确认", "需要用户确认的下一件事"),
  text("对应项目ID", "进入图书生产线后的项目ID"),
  text("目标账号组", "准备发布到的矩阵账号组"),
  text("负责人", "当前负责人"),
  text("成片路径", "审核视频或最终视频路径"),
  text("发布链接", "发布后的作品链接"),
  number("浏览量", "发布后累计浏览量"),
  number("点赞数", "发布后累计点赞数"),
  number("评论数", "发布后累计评论数"),
  text("复盘结论", "数据表现与下次优化"),
  text("备注", "版权、重复选题或其他说明"),
  date("最近更新", "最近一次状态更新"),
];
const viewDefinitions = [["未制作", "grid"], ["制作中", "grid"], ["待确认", "grid"], ["选题看板", "kanban"], ["已完成", "grid"]];

const listTables = async () => (await api(`/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`)).items ?? [];
let table = (await listTables()).find((item) => item.name === "选题词");
const log = [];
if (!table) {
  const primary = { ...fields[0] };
  delete primary.description;
  const created = await api(`/bitable/v1/apps/${APP_TOKEN}/tables`, { method: "POST", body: { table: { name: "选题词", fields: [primary] } } });
  table = { table_id: created.table_id, name: "选题词" };
  log.push("Created table 选题词");
} else {
  log.push("Existing table kept 选题词");
}

let fieldItems = (await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields?page_size=100`)).items ?? [];
const existingFields = new Set(fieldItems.map((item) => item.field_name));
for (const field of fields.slice(1)) {
  if (existingFields.has(field.field_name)) continue;
  const payload = { ...field };
  delete payload.description;
  try {
    await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields`, { method: "POST", body: payload });
    log.push(`Added field ${field.field_name}`);
  } catch (error) {
    if (error.code !== 1254014) throw error;
    log.push(`Skipped existing field ${field.field_name}`);
  }
  existingFields.add(field.field_name);
}

const views = (await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/views?page_size=100`)).items ?? [];
const existingViews = new Set(views.map((item) => item.view_name));
for (const [view_name, view_type] of viewDefinitions) {
  if (existingViews.has(view_name)) continue;
  try {
    await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/views`, { method: "POST", body: { view_name, view_type } });
    log.push(`Created view ${view_name}`);
  } catch (error) {
    log.push(`Skipped view ${view_name}: ${error.message}`);
  }
}

const finalFields = (await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields?page_size=100`)).items ?? [];
const finalViews = (await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/views?page_size=100`)).items ?? [];
const records = await api(`/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records?page_size=100`);
console.log(JSON.stringify({
  table: { name: table.name, table_id: table.table_id },
  fields: finalFields.map((item) => item.field_name),
  views: finalViews.map((item) => item.view_name),
  records: records.total ?? 0,
  log,
}, null, 2));
