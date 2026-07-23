import fs from "node:fs/promises";
import crypto from "node:crypto";

function parseArgs(argv) {
  const command = argv[0];
  const args = {};
  for (let i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    args[key] = value;
  }
  return { command, args };
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) out[match[1].trim()] = match[2].trim();
  }
  return out;
}

function requireValue(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

const { command, args } = parseArgs(process.argv.slice(2));
if (!["queue", "claim", "bootstrap", "migrate-gates", "merge-gates", "step", "status"].includes(command)) {
  throw new Error("Usage: sync_feishu_pipeline.mjs <queue|claim|bootstrap|migrate-gates|merge-gates|step|status> --binding <file> [...]");
}

const bindingPath = requireValue(args.binding, "binding");
const binding = JSON.parse(await fs.readFile(bindingPath, "utf8"));
const credentialsFile = process.env.FEISHU_CREDENTIALS_FILE || binding.credentialsFile || "F:/Codex/.secrets/feishu.env";
const credentials = parseEnv(await fs.readFile(credentialsFile, "utf8"));
if (!credentials.FEISHU_APP_ID || !credentials.FEISHU_APP_SECRET) throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET");

const API = "https://open.feishu.cn/open-apis";
const authResponse = await fetch(`${API}/auth/v3/tenant_access_token/internal`, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ app_id: credentials.FEISHU_APP_ID, app_secret: credentials.FEISHU_APP_SECRET }),
});
const auth = await authResponse.json();
if (auth.code !== 0) throw new Error(`Feishu auth ${auth.code}: ${auth.msg}`);
const token = auth.tenant_access_token;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    throw new Error(`${method} ${path} failed ${payload.code}: ${payload.msg}`);
  }
}

const appToken = binding.appToken;
const tables = binding.tables;
const tablePath = (tableId, suffix = "") => `/bitable/v1/apps/${appToken}/tables/${tableId}${suffix}`;

async function listRecords(tableId) {
  const records = [];
  let pageToken;
  do {
    const query = new URLSearchParams({ page_size: "500" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await api(`${tablePath(tableId, "/records")}?${query}`);
    records.push(...(data.items ?? []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return records;
}

async function createRecord(tableId, fields) {
  const data = await api(tablePath(tableId, "/records"), { method: "POST", body: { fields } });
  return data.record;
}

async function updateRecord(tableId, recordId, fields) {
  return api(tablePath(tableId, `/records/${recordId}`), { method: "PUT", body: { fields } });
}

function compact(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null));
}

function newProjectId() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now).reduce((acc, item) => ({ ...acc, [item.type]: item.value }), {});
  return `BK-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

async function findProject(projectId, book) {
  const records = await listRecords(tables.projects);
  return records.find((record) => projectId && record.fields?.["项目ID"] === projectId)
    ?? records.find((record) => book && record.fields?.["书名"] === book);
}

async function ensureGates(projectId, book) {
  const existing = await listRecords(tables.gates);
  const created = [];
  const updated = [];
  for (const gate of binding.gates) {
    const nodeId = `${projectId}-${gate.key}`;
    const legacy = existing.find((record) => record.fields?.["项目ID"] === projectId
      && Number(record.fields?.["顺序"]) === gate.order);
    const current = existing.find((record) => record.fields?.["节点ID"] === nodeId) ?? legacy;
    if (current) {
      const oldName = current.fields?.["确认节点"];
      const oldStatus = current.fields?.["节点状态"];
      const migrationFields = {
        "节点ID": nodeId,
        "顺序": gate.order,
        "确认节点": gate.name,
        "节点类型": gate.type,
        "是否强制": "是",
        "负责人": gate.type === "用户确认" ? "用户" : "系统",
        "下一阶段": gate.nextStage
      };
      if (oldName !== gate.name && gate.type === "用户确认" && gate.order <= 4
        && !["未开始", "待确认", "已完成（倒推）", "提前产出待确认"].includes(oldStatus)) {
        migrationFields["节点状态"] = current.fields?.["证据与文件"] ? "已完成（倒推）" : "待确认";
        const migrationNote = "历史节点迁移：旧流程未保存本确认门的独立明确确认，状态仅按既有产出倒推。";
        migrationFields["备注"] = current.fields?.["备注"]
          ? `${current.fields["备注"]}；${migrationNote}`
          : migrationNote;
      }
      await updateRecord(tables.gates, current.record_id, migrationFields);
      updated.push(nodeId);
      continue;
    }
    const status = gate.key === "G01" ? "待确认" : "未开始";
    await createRecord(tables.gates, {
      "节点ID": nodeId,
      "项目ID": projectId,
      "书名": book,
      "顺序": gate.order,
      "确认节点": gate.name,
      "节点类型": gate.type,
      "是否强制": "是",
      "节点状态": status,
      "负责人": gate.type === "用户确认" ? "用户" : "系统",
      "证据与文件": "",
      "下一阶段": gate.nextStage,
      "备注": ""
    });
    created.push(nodeId);
  }
  return { created, updated };
}

async function ensureTask(projectId, book, state = "执行中", step = "微信读书热门划线确认") {
  const records = await listRecords(tables.tasks);
  let record = records.find((item) => item.fields?.["项目ID"] === projectId && !["已完成", "已取消"].includes(item.fields?.["任务状态"]));
  const now = Date.now();
  const runId = args["run-id"] || crypto.randomUUID();
  const fields = {
    "项目ID": projectId, "书名": book, "任务类型": "新书接入", "任务状态": state,
    "当前步骤": step, "优先级": args.priority || "普通", "触发来源": args.source || "飞书新书入口",
    "最近心跳": now, "运行ID": runId, "重试次数": 0, "下一步动作": args["next-action"] || ""
  };
  if (record) await updateRecord(tables.tasks, record.record_id, fields);
  else record = await createRecord(tables.tasks, { "任务ID": `TASK-${projectId}`, "创建时间": now, ...fields });
  return { recordId: record?.record_id, runId };
}

async function bootstrap(projectId, book, author, existingProject) {
  const now = Date.now();
  const task = await ensureTask(projectId, book);
  const projectFields = compact({
    "项目ID": projectId, "书名": book, "作者": author || "待核验",
    "当前阶段": args.stage || "书目与来源核验", "进度": Number(args.progress || 10),
    "工作状态": args["work-status"] || "待用户确认", "当前待确认": args.waiting || "确认微信读书热门划线",
    "确认负责人": "用户", "文案状态": "未开始", "风格样图状态": "未开始", "分镜图状态": "未开始",
    "配音状态": "未开始", "字幕状态": "未开始", "成片状态": "未开始", "剪映草稿状态": "未开始",
    "发布状态": "未发布", "下一步动作": args["next-action"] || "展示热门划线并等待确认",
    "最近更新": now, "生产模式": args.mode || "标准全流程", "Codex状态": "等待用户确认",
    "执行指令": "自动", "任务优先级": args.priority || "普通", "Codex运行ID": task.runId,
    "Codex最近心跳": now, "Codex错误信息": ""
  });
  let projectRecord = existingProject;
  if (projectRecord) await updateRecord(tables.projects, projectRecord.record_id, projectFields);
  else projectRecord = await createRecord(tables.projects, projectFields);
  const gates = await ensureGates(projectId, book);
  return { projectId, book, projectRecordId: projectRecord?.record_id, runId: task.runId, gates };
}

async function runMigrateGates() {
  const projectId = requireValue(args["project-id"], "project-id");
  const project = await findProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (binding.gates.length === 8) {
    const existing = (await listRecords(tables.gates)).filter((record) => record.fields?.["项目ID"] === projectId);
    if (existing.some((record) => record.fields?.["确认节点"] === "视频号封面确认")) {
      return runMergeGates();
    }
  }
  const gates = await ensureGates(projectId, project.fields?.["书名"] || "");
  return { projectId, gates };
}

function gateStatus(record) {
  return record?.fields?.["节点状态"] || "未开始";
}

function isApprovedStatus(status) {
  return ["已确认", "已通过", "已完成（倒推）"].includes(status);
}

function joinEvidence(...records) {
  return [...new Set(records.map((record) => record?.fields?.["证据与文件"] || "").filter(Boolean))].join("；");
}

function joinNotes(...records) {
  return [...new Set(records.map((record) => record?.fields?.["备注"] || "").filter(Boolean))].join("；");
}

async function runMergeGates() {
  const projectId = requireValue(args["project-id"], "project-id");
  const project = await findProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const book = project.fields?.["书名"] || "";
  const records = (await listRecords(tables.gates)).filter((record) => record.fields?.["项目ID"] === projectId);
  const byName = (name) => records.find((record) => record.fields?.["确认节点"] === name);
  const byOrder = (order, excluded = new Set()) => records.find((record) => Number(record.fields?.["顺序"]) === order && !excluded.has(record.record_id));

  const review = byName("成片与剪映草稿审核") || byName("成片、剪映草稿与视频号封面审核") || byOrder(6);
  const cover = byName("视频号封面确认");
  const used = new Set([review?.record_id, cover?.record_id].filter(Boolean));
  const publication = byName("发布确认") || byOrder(8, used) || byOrder(7, used);
  used.add(publication?.record_id);
  const archive = byName("发布结果与归档") || byOrder(9, used) || byOrder(8, used);
  if (!review) throw new Error(`Review gate not found for ${projectId}`);
  if (!publication) throw new Error(`Publication gate not found for ${projectId}`);
  if (!archive) throw new Error(`Archive gate not found for ${projectId}`);

  const reviewStatus = gateStatus(review);
  const coverStatus = gateStatus(cover);
  const combinedStatus = reviewStatus === "修改中"
    ? "修改中"
    : (isApprovedStatus(reviewStatus) && isApprovedStatus(coverStatus) ? "已确认"
      : (reviewStatus === "待确认" || coverStatus === "待确认" ? "待确认" : "未开始"));
  const combinedNote = [joinNotes(review, cover), "G06 已合并成片、剪映草稿与视频号封面审核"].filter(Boolean).join("；");
  await updateRecord(tables.gates, review.record_id, {
    "节点ID": `${projectId}-G06`, "顺序": 6, "确认节点": "成片、剪映草稿与视频号封面审核",
    "节点类型": "用户确认", "是否强制": "是", "节点状态": combinedStatus, "负责人": "用户",
    "证据与文件": joinEvidence(review, cover), "下一阶段": "准备发布", "备注": combinedNote
  });
  await updateRecord(tables.gates, publication.record_id, {
    "节点ID": `${projectId}-G07`, "顺序": 7, "确认节点": "发布确认", "节点类型": "用户确认",
    "是否强制": "是", "负责人": "用户", "下一阶段": "正式发布"
  });
  await updateRecord(tables.gates, archive.record_id, {
    "节点ID": `${projectId}-G08`, "顺序": 8, "确认节点": "发布结果与归档", "节点类型": "系统记录",
    "是否强制": "是", "负责人": "系统", "下一阶段": "流程结束"
  });

  let legacyCover = null;
  if (cover && cover.record_id !== review.record_id && cover.record_id !== publication.record_id && cover.record_id !== archive.record_id) {
    legacyCover = cover.record_id;
    await updateRecord(tables.gates, cover.record_id, {
      "节点ID": `${projectId}-LEGACY-COVER`, "顺序": 99, "确认节点": "历史记录：视频号封面节点已并入 G06",
      "节点类型": "系统记录", "是否强制": "否", "节点状态": isApprovedStatus(coverStatus) ? "已完成（倒推）" : "未开始",
      "负责人": "系统", "下一阶段": "流程审计", "备注": "封面证据已合并到 G06；保留本行用于历史审计"
    });
  }
  return { projectId, book, merged: `${projectId}-G06`, publication: `${projectId}-G07`, archive: `${projectId}-G08`, legacyCover };
}

async function runClaim() {
  const records = await listRecords(tables.projects);
  const target = records.find((record) => {
    const book = record.fields?.["书名"];
    const projectId = record.fields?.["项目ID"];
    const state = record.fields?.["Codex状态"];
    const instruction = record.fields?.["执行指令"];
    return book && !projectId && (!state || state === "待领取") && !["暂停", "取消"].includes(instruction);
  });
  if (!target) return { claimed: false };
  const projectId = newProjectId();
  const book = target.fields["书名"];
  const result = await bootstrap(projectId, book, target.fields?.["作者"], target);
  return { claimed: true, ...result };
}

async function runQueue() {
  const records = await listRecords(tables.projects);
  const items = records
    .filter((record) => record.fields?.["书名"])
    .filter((record) => !["已完成", "已取消"].includes(record.fields?.["Codex状态"]))
    .map((record) => ({
      recordId: record.record_id,
      projectId: record.fields?.["项目ID"] || null,
      book: record.fields?.["书名"],
      author: record.fields?.["作者"] || null,
      stage: record.fields?.["当前阶段"] || null,
      waiting: record.fields?.["当前待确认"] || null,
      codexStatus: record.fields?.["Codex状态"] || "待领取",
      codexHeartbeat: record.fields?.["Codex最近心跳"] || null,
      instruction: record.fields?.["执行指令"] || "自动",
      nextAction: record.fields?.["下一步动作"] || null
    }))
    .filter((item) => !["暂停", "取消"].includes(item.instruction));
  return { items };
}

async function runBootstrap() {
  const projectId = requireValue(args["project-id"], "project-id");
  const book = requireValue(args.book, "book");
  const existing = await findProject(projectId, book);
  return bootstrap(projectId, book, args.author, existing);
}

async function runStep() {
  const projectId = requireValue(args["project-id"], "project-id");
  const project = await findProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const now = Date.now();
  const projectFields = compact({
    "作者": args.author,
    "内容主题": args["content-theme"],
    "当前阶段": args.stage,
    "进度": args.progress === undefined ? undefined : Number(args.progress),
    "工作状态": args["work-status"],
    "当前待确认": args.waiting,
    "文案状态": args["copy-status"],
    "风格样图状态": args["style-status"],
    "分镜图状态": args["image-status"] ?? args["images-status"],
    "配音状态": args["voice-status"],
    "字幕状态": args["caption-status"] ?? args["captions-status"],
    "成片状态": args["video-status"],
    "剪映草稿状态": args["draft-status"],
    "发布状态": args["publish-status"],
    "成片时长(秒)": args.duration === undefined ? undefined : Number(args.duration),
    "下一步动作": args["next-action"],
    "阻塞与风险": args.risk,
    "质检结果": args.quality,
    "数据来源": args.source,
    "工作目录": args["work-dir"],
    "成片路径": args["video-path"],
    "最近更新": now,
    "Codex状态": args["codex-status"],
    "Codex运行ID": args["run-id"],
    "Codex最近心跳": now,
    "Codex错误信息": args.error
  });
  if (Object.keys(projectFields).length) await updateRecord(tables.projects, project.record_id, projectFields);

  let gateResult;
  if (args.gate) {
    const gate = binding.gates.find((item) => item.key === args.gate);
    if (!gate) throw new Error(`Unknown gate: ${args.gate}`);
    const nodeId = `${projectId}-${gate.key}`;
    const gates = await listRecords(tables.gates);
    const gateRecord = gates.find((item) => item.fields?.["节点ID"] === nodeId);
    if (!gateRecord) throw new Error(`Gate not found: ${nodeId}`);
    const fields = compact({
      "节点状态": args["gate-status"], "证据与文件": args.evidence,
      "备注": args.note, "下一阶段": args["next-stage"] || gate.nextStage
    });
    await updateRecord(tables.gates, gateRecord.record_id, fields);
    gateResult = { nodeId, ...fields };
  }

  const tasks = await listRecords(tables.tasks);
  const task = tasks.find((item) => item.fields?.["项目ID"] === projectId && !["已完成", "已取消"].includes(item.fields?.["任务状态"]));
  if (task) {
    await updateRecord(tables.tasks, task.record_id, compact({
      "任务状态": args["codex-status"], "当前步骤": args.stage, "最近心跳": now,
      "运行ID": args["run-id"], "输出路径": args.evidence || args["video-path"],
      "错误信息": args.error, "下一步动作": args["next-action"]
    }));
  }
  return { projectId, updatedProjectFields: projectFields, gate: gateResult };
}

async function runStatus() {
  const projectId = requireValue(args["project-id"], "project-id");
  const project = await findProject(projectId);
  const gates = (await listRecords(tables.gates)).filter((item) => item.fields?.["项目ID"] === projectId);
  return { project: project?.fields ?? null, gates: gates.map((item) => item.fields).sort((a, b) => a["顺序"] - b["顺序"]) };
}

const result = command === "queue" ? await runQueue()
  : command === "claim" ? await runClaim()
  : command === "bootstrap" ? await runBootstrap()
  : command === "migrate-gates" ? await runMigrateGates()
  : command === "merge-gates" ? await runMergeGates()
  : command === "step" ? await runStep()
  : await runStatus();

console.log(JSON.stringify(result, null, 2));
