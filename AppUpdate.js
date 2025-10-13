/**
 * AppUpdate.js - 批量检测 App Store 更新（集成 OpenAI 日志精简 & 自动国家/地区识别）
 *
 * 功能：
 * - 监控 App Store 应用更新并发送通知。
 * - 自动从 URL 或纯数字 ID 中提取 App ID。
 * - 自动识别 URL 中的国家/地区（cn/us），调用对应区域 Lookup API。
 * - (新) 可选：调用 OpenAI API 将更新日志精简为 20 字以内的中文摘要。
 */

/* ---------------------- 用户配置区 ---------------------- */
const USE_OPENAI_SUMMARY = true;
const OPENAI_API_URL = "https://free.v36.cm/v1/chat/completions";
const OPENAI_API_KEY = "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

/* ---------------------- 辅助函数 ---------------------- */

/**
 * 提取输入中所有有效 App ID
 * 同时返回每个 ID 对应的国家/地区
 * @param {string|object} rawArg
 * @returns {Array<{id:string,country:string}>}
 */
function extractAppIds(rawArg) {
  if (!rawArg) return [];

  let rawStr = "";
  if (typeof rawArg === 'object' && rawArg !== null) {
    const preferKeys = ["app_ids", "appIds", "arg", "arg1", "arg0"];
    for (const k of preferKeys) {
      if (Object.prototype.hasOwnProperty.call(rawArg, k) && rawArg[k]) {
        rawStr = String(rawArg[k]);
        break;
      }
    }
    if (!rawStr) {
      rawStr = Object.keys(rawArg).map(k => String(rawArg[k] || "")).join(",");
    }
  } else if (typeof rawArg === 'string') {
    rawStr = rawArg;
  }

  // 处理连续 URL
  const separatorRegex = /(https:\/\/apps\.apple\.com\/.*?)https:\/\//gi;
  if (rawStr.includes('apps.apple.com/') && separatorRegex.test(rawStr)) {
    rawStr = rawStr.replace(separatorRegex, '$1,https://');
    console.log("检测到连续 App Store URL 并已用逗号分隔。");
  }

  const items = rawStr.split(/[\s,;，\n\r]+/).map(s => s.trim()).filter(Boolean);

  const results = items.map(s => {
    const matchId = s.match(/id(\d+)/i);
    if (matchId) {
      const id = matchId[1];
      const countryMatch = s.match(/\/(cn|us)\//i);
      const country = countryMatch ? countryMatch[1].toLowerCase() : 'us';
      return { id, country };
    } else if (/^\d+$/.test(s)) {
      return { id: s, country: 'us' };
    }
    return null;
  }).filter(Boolean);

  return results;
}

/**
 * 获取 App Store 应用信息，自动对应国家/地区
 * @param {string} appId
 * @param {string} country
 * @returns {Promise<object>}
 */
function getAppInfo(appId, country='us') {
  const url = `https://itunes.apple.com/${country}/lookup?id=${appId}`;
  return new Promise((resolve, reject) => {
    $httpClient.get(url, (err, resp, data) => {
      if (err) return reject(err);
      try {
        const obj = JSON.parse(data);
        if (obj && obj.resultCount > 0) {
          resolve(obj.results[0]);
        } else {
          reject(new Error(`App ID ${appId} 在 ${country} 区未找到信息`));
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
      messages: [{
        role: "system",
        content: "你是一个更新日志总结助手。请将用户提供的更新日志内容总结为20个字以内的中文摘要，只输出总结后的核心内容，不要任何额外解释或标点。",
      }, {
        role: "user",
        content: notes,
      }],
      max_tokens: 60,
      temperature: 0.3,
    };

    $httpClient.post({ url: OPENAI_API_URL, headers, body: JSON.stringify(body) }, (err, resp, data) => {
      if (err) return reject(err);
      try {
        const obj = JSON.parse(data);
        if (obj.choices && obj.choices[0] && obj.choices[0].message) {
          resolve(obj.choices[0].message.content.trim());
        } else {
          reject(new Error("OpenAI 响应无效"));
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * 检查单个 App 更新
 */
async function checkApp({id: appId, country}) {
  const STORE_KEY = `app_update_${appId}_version`;
  try {
    const info = await getAppInfo(appId, country);
    const name = info.trackName || `App(${appId})`;
    const version = info.version || "";
    const appUrl = info.trackViewUrl || `https://apps.apple.com/app/id${appId}`;
    const notes = info.releaseNotes || "暂无更新日志";
    const lastVersion = $persistentStore.read(STORE_KEY);

    console.log(`正在检查 [${name}](${country})：商店版本='${version}', 本地记录版本='${lastVersion}'`);

    if (lastVersion !== version) {
      let summary = "";
      try {
        if (USE_OPENAI_SUMMARY && OPENAI_API_KEY && OPENAI_API_URL) {
          summary = await summarizeNotes(notes);
        } else {
          summary = notes.split("\n").slice(0, 5).join("\n");
        }
      } catch (e) {
        summary = `[摘要失败] ${notes.split("\n").slice(0, 3).join("\n")}...`;
      }

      $notification.post(`${name} 更新啦 🎉`, `版本：${version}`, summary, appUrl);
      $persistentStore.write(version, STORE_KEY);
      console.log(`[${name}] 更新至 ${version}，通知已发送。`);
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
  let appList = extractAppIds(rawArg);

  if ((!appList || appList.length === 0) && typeof $persistentStore !== "undefined") {
    const stored = $persistentStore.read("app_ids") || "";
    if (stored) appList = appList.concat(extractAppIds(stored));
  }

  const uniqueApps = [...new Map(appList.map(a => [a.id, a])).values()];

  if (uniqueApps.length === 0) {
    console.error("请传入至少一个有效 App ID 或 App Store URL");
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
  console.error(`脚本执行致命错误：${err}`);
  $done();
});
