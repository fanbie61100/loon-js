const USE_OPENAI_SUMMARY = true;
const OPENAI_API_URL = "https://api.chatanywhere.tech/v1/chat/completions";
const OPENAI_API_KEY = "sk-36yyo8cliEsad9VfzXj4QP05C4DIYK0lJBUqEMRPqbZiHJLs";

function extractCountryCode(url) {
  const match = url.match(/https:\/\/apps\.apple\.com\/([a-z]{2})\//i);
  return match ? match[1].toLowerCase() : 'us';
}

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

function summarizeNotes(notes) {
  if (!notes || notes.trim() === "") return Promise.resolve("暂无更新日志。");
  return new Promise((resolve, reject) => {
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    };
    const body = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "你是更新日志总结助手，将日志总结为45 字以内的简体中文摘要，不要遗漏内容，摘要中不许出现版本号信息和软件名。" },
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

function extractAppIds(rawArg) {
  if (!rawArg) return [];

  let rawStr = "";
  if (typeof rawArg === 'object' && rawArg !== null && rawArg.app_ids) {
    rawStr = String(rawArg.app_ids);
  } else if (typeof rawArg === 'string') {
    rawStr = rawArg;
  } else {
    return [];
  }

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

function versionCompare(v1, v2) {
    if (v1 === v2) return 0;
    if (!v1) return -1;
    if (!v2) return 1;

    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    const len = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < len; i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;

        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }
    return 0;
}

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

    if (!lastVersion || versionCompare(version, lastVersion) > 0) {
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
    } else if (versionCompare(version, lastVersion) < 0) {
        console.log(`[${name}] 商店版本 ${version} 低于本地记录版本 ${lastVersion}，跳过通知。`);
        return { id: appId, name, version, updated: false, reason: "Store version is lower" };
    }
    else {
      console.log(`[${name}] 无新版本。`);
      return { id: appId, name, version, updated: false };
    }
  } catch (err) {
    const errorMessage = err && err.message ? err.message : String(err);
    console.error(`App ID ${appId} 检测失败：${errorMessage}`);
    return { id: appId, error: errorMessage };
  }
}

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
