let obj = JSON.parse($response.body);
obj.data = obj.data.filter(i => 
    i.entityType !== "textLink" && ![1001,1003,1004,1005].includes(i.entityId)
);
obj.data.forEach(i => {
    if (i.entities) {
        i.entities = i.entities.filter(e => e.entityType !== "textLink");
    }
});
$done({ body: JSON.stringify(obj) });
