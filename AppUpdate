/**
 * AppUpdate.js - 批量检测 App Store 更新（集成 OpenAI 日志精简 & 修复版）
 *
 * 功能：
 * - 监控 App Store 应用更新并发送通知。
 * - 自动从 URL 或纯数字 ID 中提取 App ID。
 * - (新) 可选：调用 OpenAI API 将更新日志精简为 20 字以内的中文摘要。
 *
 * v2.0 更新日志：
 * - [修复] 移除了检查更新时的国家/地区限制，避免因区域更新延迟而漏掉通知（特别是英文日志的更新）。
 * - [优化] 增加了版本对比的调试日志，方便排查“无更新”的原因。
 * - [优化] 增强了网络请求的错误处理和日志记录。
 *
 * 使用说明：
 * 1. 在 Loon 插件 Argument 中填写 app_ids，例如：
 * https://apps.apple.com/us/app/my-baby-unicorn/id1442079205?l=zh-Hans-CN,1051902027
 * - 支持逗号、空格、分号、换行、中文逗号分隔。
 * 2. （可选）如需使用 OpenAI 日志精简功能，请配置下方 OpenAI 相关参数。
 *
 * 注意：已根据您的反馈修复 $notification.post 的 URL 参数问题，以兼容 Loon 的点击跳转。
 *
 * ！！！此版本已移除 '合并通知' 模块，所有更新将单独发送通知。！！！
 */

/* ---------------------- 用户配置区 ---------------------- */

// --- OpenAI 日志精简配置 ---
const USE_OPENAI_SUMMARY = true; // 总开关：是否启用 OpenAI 精简日志功能
const OPENAI_API_URL = "https://free.v36.cm/v1/chat/completions"; // 您的 OpenAI API URL
const OPENAI_API_KEY = "sk-9xWv9xwILwqw5g8hC363B532B9Ad4f21BfBfA3019c988f0f"; // 您的 OpenAI API KEY

/* ---------------------- 辅助函数 ---------------------- */

/**
 * 提取输入中所有有效 App ID
 * @param {string|object} rawArg - $argument 或字符串
 * @returns {string[]} - 数字 App ID 数组
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
  
  // --- START: 新增对连续 App Store URL 的分隔处理 ---
  // 匹配形如: `URL1https://apps.apple.com/URL2` 的模式，并在中间插入逗号。
  // 这解决了您提到的 `...CNhttps://apps.apple.com/...` 连在一起的问题。
  const separatorRegex = /(https:\/\/apps\.apple\.com\/.*?)https:\/\//gi;
  if (rawStr.includes('apps.apple.com/') && separatorRegex.test(rawStr)) {
      rawStr = rawStr.replace(separatorRegex, '$1,https://');
      console.log("检测到连续 App Store URL 并已用逗号分隔。");
  }
  // --- END: 新增对连续 App Store URL 的分隔处理 ---

  const items = rawStr.split(/[\s,;，\n\r]+/).map(s => s.trim()).filter(Boolean);
  const ids = items.map(s => {
    const match = s.match(/id(\d+)/i);
    if (match) return match[1];
    if (/^\d+$/.test(s)) return s;
    return null;
  }).filter(Boolean);

  return ids;
}

/**
 * 获取 App Store 应用信息（全局）
 * @param {string} appId - 应用 ID
 * @returns {Promise<object>} - 应用信息
 */
function getAppInfo(appId) {
  // [修复] 移除 &country=cn 参数，进行全局查找，避免区域性更新延迟
  const url = `https://itunes.apple.com/lookup?id=${appId}`;
  return new Promise((resolve, reject) => {
    $httpClient.get(url, (err, resp, data) => {
      if (err) return reject(err);
      try {
        const obj = JSON.parse(data);
        if (obj && obj.resultCount > 0) {
          resolve(obj.results[0]);
        } else {
          reject(new Error(`App ID ${appId} 未找到信息`));
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * 使用 OpenAI API 精简更新日志
 * @param {string} notes - 原始更新日志
 * @returns {Promise<string>} - 精简后的日志
 */
function summarizeNotes(notes) {
    if (!notes || notes.trim() === "") {
        return Promise.resolve("暂无更新日志。");
    }
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
            }, ],
            max_tokens: 60,
            temperature: 0.3,
        };

        $httpClient.post({ url: OPENAI_API_URL, headers, body: JSON.stringify(body) }, (err, resp, data) => {
            if (err) {
                console.error(`OpenAI API 请求失败: ${err}`);
                return reject(new Error(`OpenAI 请求失败: ${err}`));
            }
            try {
                const obj = JSON.parse(data);
                if (obj.choices && obj.choices[0] && obj.choices[0].message) {
                    const summary = obj.choices[0].message.content.trim();
                    console.log(`OpenAI 总结成功: ${summary}`);
                    resolve(summary);
                } else {
                    const errorInfo = obj.error ? obj.error.message : "未知响应格式";
                    console.error(`OpenAI API 响应无效: ${errorInfo}`);
                    reject(new Error(`API 响应无效: ${errorInfo}`));
                }
            } catch (e) {
                console.error(`解析 OpenAI 响应失败: ${e}`);
                reject(e);
            }
        });
    });
}


/**
 * 检查单个 App 更新
 * @param {string} appId - 应用 ID
 * @returns {Promise<object>} - 检测结果
 */
async function checkApp(appId) {
  const STORE_KEY = `app_update_${appId}_version`;
  try {
    const info = await getAppInfo(appId);
    const name = info.trackName || `App(${appId})`;
    const version = info.version || "";
    const appUrl = info.trackViewUrl || `https://apps.apple.com/app/id${appId}`;
    const notes = info.releaseNotes || "暂无更新日志";

    const lastVersion = $persistentStore.read(STORE_KEY);
    
    // [优化] 增加版本对比日志，方便调试
    console.log(`正在检查 [${name}]: 商店版本='${version}', 本地记录版本='${lastVersion}'`);

    if (lastVersion !== version) {
      console.log(`[${name}] 检测到新版本 ${version}，准备发送通知...`);
      let summary = "";
      try {
        if (USE_OPENAI_SUMMARY && OPENAI_API_KEY && OPENAI_API_URL) {
          console.log(`正在为 [${name}] 请求 OpenAI 日志摘要...`);
          summary = await summarizeNotes(notes);
        } else {
          summary = notes.split("\n").slice(0, 5).join("\n");
        }
      } catch (summaryError) {
        console.error(`[${name}] 日志总结失败, 将使用原始日志。错误: ${summaryError}`);
        summary = `[摘要失败] ${notes.split("\n").slice(0, 3).join("\n")}...`;
      }

      const title = `${name} 更新啦 🎉`;
      const sub = `版本：${version}`;
      const content = `${summary}`;
      
      // [修复] 将 URL 直接作为第四个参数传入，以兼容 Loon 的点击跳转
      // 由于移除了 AGGREGATE 模式，这里直接发送通知
      $notification.post(title, sub, content, appUrl);
      
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
  let ids = extractAppIds(rawArg);

  if ((!ids || ids.length === 0) && typeof $persistentStore !== "undefined") {
    const stored = $persistentStore.read("app_ids") || "";
    if (stored) ids = ids.concat(extractAppIds(stored));
  }

  const uniqueIds = [...new Set(ids.filter(id => /^\d+$/.test(id)))];

  if (uniqueIds.length === 0) {
    console.error("请在插件 Argument 中传入至少一个有效的 App ID（例如：1051902027 或完整的 App Store 链接）");
    $done();
    return;
  }

  console.log(`开始检测 ${uniqueIds.length} 个 App...`);

  // 由于移除了 AGGREGATE 模式，这里不再收集更新列表，而是直接在 checkApp 中发送通知
  for (const id of uniqueIds) {
    await checkApp(id);
  }

  console.log("所有任务执行完毕。");
  $done();
}

main().catch(err => {
  console.error(`脚本执行出现致命错误: ${err}`);
  $done();
});
