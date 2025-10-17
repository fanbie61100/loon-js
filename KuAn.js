// 2025.10.7

const url = $request.url;
const obj = JSON.parse($response.body);

if (url.includes("/v6/account/loadConfig?key=my_page_card_config")) {
    obj.data = obj.data.filter(item => {
        if (item.entities) {
            item.entities = item.entities.filter(entity => entity.entityType !== 'textLink');
        }
        return item.entityType !== 'textLink' && ![1001, 1003, 1004, 1005].includes(item.entityId);
    });
} else if (url.includes("/v6/page/dataList")) {
    obj.data = obj.data.filter(item => item.title !== "话题热议" && ![36104,24309,12889,21063,35730,35846,28374,28375,27332,20090,28773,29343,21106].includes(item.entityId));
    obj.data.forEach(item => {
        if (item.entities) {
            item.entities = item.entities.filter(entity => entity.title !== "睡个好觉需要什么？");
        }
    });
} else if (url.includes("/v6/main/indexV8")) {
    obj.data = obj.data.filter(item => 
        ![32557,29349,28621].includes(item.entityId) &&
        !(typeof item.title === 'string' && (item.title.includes("值得买") || item.title.includes("红包")))
    );
} else if (url.includes("/v6/main/init")) {
    // ✅ 只保留标题为“话题”、“关注”、“头条”的项目
    const keepTitles = ["话题", "关注", "头条"];
    obj.data = obj.data.filter(item => {
        if (item.entities && Array.isArray(item.entities)) {
            item.entities = item.entities.filter(entity => keepTitles.includes(entity.title));
        }
        return keepTitles.includes(item.title);
    });
}

obj.data?.forEach(item => {
    if (item.extraDataArr) {
        delete item.extraDataArr['SplashAd.Type'];
        delete item.extraData;
        delete item.extraDataArr;
    }
});

$done({ body: JSON.stringify(obj) });
