// Fetch complete BGA notification history and return raw data for Python processing.
// Game-agnostic — reads table ID and game name from the current URL.
// Returns JSON: {players: {pid: name, ...}, gamedatas: {...}, packets: [...]}
(function() {
    var tableMatch = window.location.search.match(/table=(\d+)/);
    if (!tableMatch) return JSON.stringify({error: 'No table= param in URL'});
    var tableId = parseInt(tableMatch[1]);
    // BGA URLs: /<N>/<game> or /<N>/<game>/<game> — endpoint always uses /<N>/<game>/<game>/
    var parts = window.location.pathname.split('/');
    var endpoint = '/' + parts[1] + '/' + parts[2] + '/' + parts[2] + '/notificationHistory.html';
    return new Promise(function(resolve) {
        gameui.ajaxcall(
            endpoint,
            {table: tableId, from: 0, privateinc: 1, history: 1},
            gameui,
            function(result) {
                var playerNames = {};
                if (typeof gameui !== 'undefined' && gameui.gamedatas && gameui.gamedatas.players) {
                    var players = gameui.gamedatas.players;
                    for (var pid in players) { playerNames[pid] = players[pid].name; }
                }
                var gamedatas = (typeof gameui !== 'undefined' && gameui.gamedatas) ? gameui.gamedatas : null;
                resolve(JSON.stringify({players: playerNames, gamedatas: gamedatas, packets: result.data}));
            },
            function(is_error, error_msg) {
                resolve(JSON.stringify({error: true, msg: error_msg}));
            }
        );
    });
})();
