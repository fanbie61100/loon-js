// ==UserScript==
// @version        2025.10.18
// @description    净化首页、发现页与个人页，移除广告、话题、头条等模块
// ==/UserScript==

const url = $request.url;
let obj;

try {
    obj = JSON.parse($response.body);
} catch (e) {
    console.log("解析响应出错:", e);
    $done({ body: $response.body });
    return;
}

// 辅助函数：安全过滤数组
function safeFilter(arr, fn) {
    return Array.isArray(arr) ? arr.filter(fn) : arr;
}

// ==================== 分支 1: 我的页面 ====================
if (url.includes("/v6/account/loadConfig?key=my_page_card_config")) {
    obj.data = safeFilter(obj.data, item => {
        if (item.entities) {
            item.entities = item.entities.filter(entity => entity.entityType !== "textLink");
        }
        return item.entityType !== "textLink" &&
               ![1001, 1003, 1004, 1005].includes(item.entityId);
    });
}

// ==================== 分支 2: 发现页 ====================
else if (url.includes("/v6/page/dataList")) {
    obj.data = safeFilter(obj.data, item =>
        item.title !== "话题热议" &&
        ![36104, 24309, 12889, 21063, 35730, 35846, 28374, 28375, 27332, 20090, 28773, 29343, 21106]
        .includes(item.entityId)
    );

    obj.data.forEach(item => {
        if (item.entities) {
            item.entities = item.entities.filter(entity => entity.title !== "睡个好觉需要什么？");
        }
    });
}

// ==================== 分支 3: 首页推荐 ====================
else if (url.includes("/v6/main/indexV8")) {
    obj.data = safeFilter(obj.data, item =>
        ![32557, 29349, 28621].includes(item.entityId) &&
        !(typeof item.title === "string" && (item.title.includes("值得买") || item.title.includes("红包")))
    );
}

// ==================== 分支 4: 首页初始化（增强版） ====================
else if (url.includes("/v6/main/init")) {
    try {
        if (Array.isArray(obj.data)) {
            const parentRemoveIds = new Set([944, 945, 24455, 36839, 1635]);
            const childRemoveIds = new Set([1635, 2261, 1633, 413, 417, 1754, 1966, 2274, 1170, 1175, 1190, 2258]);
            const titleRemoveSet = new Set(["关注", "话题", "头条"]); // ← 新增过滤标题

            // 过滤父级模块
            obj.data = obj.data.filter(item => {
                const id = String(item.entityId || "");
                const title = String(item.title || "");
                const remove = parentRemoveIds.has(id) || titleRemoveSet.has(title);
                if (remove) console.log("移除父模块:", id, title);
                return !remove;
            });

            // 过滤子模块
            obj.data.forEach(item => {
                if (Array.isArray(item.entities)) {
                    item.entities = item.entities.filter(entity => {
                        const id = String(entity.entityId || "");
                        const title = String(entity.title || "");
                        const remove = childRemoveIds.has(id) || titleRemoveSet.has(title);
                        if (remove) console.log("移除子模块:", id, title);
                        return !remove;
                    });
                }
            });
        }
    } catch (e) {
        console.log("处理 /v6/main/init 出错:", e);
    }
}

// ==================== 通用清理 ====================
try {
    if (Array.isArray(obj.data)) {
        obj.data.forEach(item => {
            if (item.extraDataArr) {
                delete item.extraDataArr["SplashAd.Type"];
                delete item.extraData;
                delete item.extraDataArr;
            }
        });
    }
} catch (e) {
    console.log("通用清理出错:", e);
}

$done({ body: JSON.stringify(obj) });
