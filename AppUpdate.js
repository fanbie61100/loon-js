/**
 * AppUpdate.js - 批量检测 App Store 更新（集成 OpenAI 日志精简 & 多区回退版）
 *
 * 功能：
 * - 监控 App Store 应用更新并发送通知。
 * - 自动从 URL 或纯数字 ID 中提取 App ID，并识别国家/地区。
 * - (新) 可选：调用 OpenAI API 将更新日志精简为 20 字以内的简体中文摘要。
 *
 * v3.0 更新日志：
 * - 自动解析 URL 国家/地区（如 cn、us）并查询对应 App Store。
 * - 如果指定国家查询失败，自动回退到 us 区查询。
 * - 支持连续 URL 自动分隔。
 */

/* ---------------------- 用户配置区 ---------------------- */
// --- OpenAI 日志精简配置 ---
const USE_OPENAI_SUMMARY = true; // 总开关：是否启用 OpenAI 精简日志功能
const OPENAI_API_URL = "https://free.v36.cm/v1/chat/completions"; // OpenAI API URL
const OPENAI_API_KEY = "sk-9xWv9xwILwqw5g8hC363B532B9Ad4f21BfBfA3019c988f0f"; // OpenAI API KEY

/* ---------------------- 辅助函数 ---------------------- */

/**
 * 提取 App Store URL 中的国家代码
 * @param {string} url - App Store 应用链接
 * @returns {string} - 国家代码（如 'cn'、'us'），默认 'us'
 */
function extractCountryCode(url) {
  const match = url.match(/https:\/\/apps\.apple\.com\/([a-z]{2})\//i);
  return match ? match[1].toLowerCase() : 'us';
}

/**
 * 获取 App Store 应用信息（可选国家/地区，失败回退 us）
 * @param {string} appId - 应用 ID
 * @param {string} url - 可选 App Store URL
 * @param {boolean} fallback - 是否允许回退到 us 区
 * @returns {Promise<object>} - 应用信息
 */
async function getAppInfo(appId, url = "", fallback = true) {
  const countryCode = url ? extractCountryCode(url) : 'us';
  const apiUrl = `https://itunes.apple.com/${countryCode}/lookup?id=${appId}`;
  return new Promise((resolve, reject) => {
    $httpClient.get(apiUrl, async (err, resp, data) => {
      if (err) {
        if (fallback && countryCode !== 'us') {
          console.log(`查询 ${countryCode} 区失败，回退到 us 区`);
          try { resolve(await getAppInfo(appId, "", false)); } catch(e){ reject(e); }
        } else reject(err);
        return;
      }
      try {
        const obj = JSON.parse(data);
        if (obj && obj.resultCount > 0) {
          resolve(obj.results[0]);
        } else {
          if (fallback && countryCode !== 'us') {
            console.log(`App ID ${appId} 在 ${countryCode} 区未找到，回退到 us 区`);
            resolve(await getAppInfo(appId, "", false));
          } else reject(new Error(`App ID ${appId} 未找到信息 (country=${countryCode})`));
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * 使用 OpenAI API 精简更新日志
 */
function summarizeNotes(notes) {
  if (!notes || notes.trim() === "") return Promise.resolve("暂无更新日志。");
  return new Promise((resolve, reject) => {
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    };
    const body = {
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "你是更新日志总结助手，将日志总结为20字以内的简体中文摘要，不要额外解释，不要出现版本号信息和软件名。" },
        { role: "user", content: notes }
      ],
      max_tokens: 60,
      temperature: 0.3,
    };
    $httpClient.post({ url: OPENAI_API_URL, headers, body: JSON.stringify(body) }, (err, resp, data) => {
      if (err) return reject(new Error(`OpenAI 请求失败: ${err}`));
      try {
        const obj = JSON.parse(data);
        if (obj.choices && obj.choices[0] && obj.choices[0].message) {
          resolve(obj.choices[0].message.content.trim());
        } else {
          const errorInfo = obj.error ? obj.error.message : "未知响应格式";
          reject(new Error(`API 响应无效: ${errorInfo}`));
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * 提取输入中所有有效 App ID 和对应 URL
 */
function extractAppIds(rawArg) {
  if (!rawArg) return [];
  let rawStr = "";
  if (typeof rawArg === 'object' && rawArg !== null) {
    const preferKeys = ["app_ids", "appIds", "arg", "arg1", "arg0"];
    for (const k of preferKeys) {
      if (Object.prototype.hasOwnProperty.call(rawArg, k) && rawArg[k]) { rawStr = String(rawArg[k]); break; }
    }
    if (!rawStr) rawStr = Object.keys(rawArg).map(k => String(rawArg[k]||"")).join(",");
  } else if (typeof rawArg === 'string') rawStr = rawArg;

  // 自动分隔连续 URL
  const separatorRegex = /(https:\/\/apps\.apple\.com\/.*?)https:\/\//gi;
  if (rawStr.includes('apps.apple.com/') && separatorRegex.test(rawStr)) {
    rawStr = rawStr.replace(separatorRegex, '$1,https://');
    console.log("检测到连续 App Store URL 并已用逗号分隔。");
  }

  const items = rawStr.split(/[\s,;，\n\r]+/).map(s => s.trim()).filter(Boolean);
  const result = items.map(s => {
    const match = s.match(/id(\d+)/i);
    if (match) return { id: match[1], url: s };
    if (/^\d+$/.test(s)) return { id: s, url: "" };
    return null;
  }).filter(Boolean);
  return result;
}

/**
 * 检查单个 App 更新
 */
async function checkApp(app) {
  const { id: appId, url: appUrlRaw } = app;
  const STORE_KEY = `app_update_${appId}_version`;
  try {
    const info = await getAppInfo(appId, appUrlRaw);
    const name = info.trackName || `App(${appId})`;
    const version = info.version || "";
    const appUrl = info.trackViewUrl || `https://apps.apple.com/app/id${appId}`;
    const notes = info.releaseNotes || "暂无更新日志";
    const lastVersion = $persistentStore.read(STORE_KEY);

    console.log(`正在检查 [${name}]: 商店版本='${version}', 本地记录版本='${lastVersion}'`);

    if (lastVersion !== version) {
      console.log(`[${name}] 检测到新版本 ${version}，准备发送通知...`);
      let summary = "";
      try {
        if (USE_OPENAI_SUMMARY && OPENAI_API_KEY && OPENAI_API_URL) {
          summary = await summarizeNotes(notes);
        } else {
          summary = notes.split("\n").slice(0, 5).join("\n");
        }
      } catch (summaryError) {
        console.error(`[${name}] 日志总结失败，使用原始日志: ${summaryError}`);
        summary = `[摘要失败] ${notes.split("\n").slice(0,3).join("\n")}...`;
      }

      $notification.post(`${name} 更新啦 🎉`, `版本：${version}`, summary, appUrl);
      $persistentStore.write(version, STORE_KEY);
      console.log(`[${name}] (${appId}) 更新至 ${version}，通知已发送。`);
      return { id: appId, name, version, updated: true, notes: summary, url: appUrl };
    } else {
      console.log(`[${name}] 无新版本。`);
      return { id: appId, name, version, updated: false };
    }
  } catch (err) {
    const errorMessage = err && err.message ? err.message : String(err);
    console.error(`App ID ${appId} 检测失败：${errorMessage}`);
    return { id: appId, error: errorMessage };
  }
}

/**
 * 主函数
 */
async function main() {
  const rawArg = (typeof $argument !== "undefined") ? $argument : "";
  let apps = extractAppIds(rawArg);

  if ((!apps || apps.length === 0) && typeof $persistentStore !== "undefined") {
    const stored = $persistentStore.read("app_ids") || "";
    if (stored) apps = apps.concat(extractAppIds(stored));
  }

  const uniqueApps = [...new Map(apps.map(a => [a.id, a])).values()];

  if (uniqueApps.length === 0) {
    console.error("请在插件 Argument 中传入至少一个有效的 App ID 或 URL");
    $done();
    return;
  }

  console.log(`开始检测 ${uniqueApps.length} 个 App...`);
  for (const app of uniqueApps) {
    await checkApp(app);
  }

  console.log("所有任务执行完毕。");
  $done();
}

main().catch(err => {
  console.error(`脚本执行出现致命错误: ${err}`);
  $done();
});

