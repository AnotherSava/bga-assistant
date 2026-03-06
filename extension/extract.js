// Extraction script injected into BGA page via chrome.scripting.executeScript
// Runs in the MAIN world to access gameui and BGA's ajaxcall API.
// Returns {players, gamedatas, packets} on success or {error, msg} on failure.
(function () {
  var tableMatch = window.location.search.match(/table=(\d+)/);
  if (!tableMatch) return { error: true, msg: "No table= param in URL" };
  var tableId = parseInt(tableMatch[1]);

  // BGA URLs: /<N>/<game> or /<N>/<game>/<game> — endpoint always uses /<N>/<game>/<game>/
  var parts = window.location.pathname.split("/");
  var endpoint =
    "/" + parts[1] + "/" + parts[2] + "/" + parts[2] + "/notificationHistory.html";

  if (typeof gameui === "undefined" || !gameui || !gameui.ajaxcall) {
    return { error: true, msg: "gameui not available — is this a BGA game page?" };
  }

  return new Promise(function (resolve) {
    gameui.ajaxcall(
      endpoint,
      { table: tableId, from: 0, privateinc: 1, history: 1 },
      gameui,
      function (result) {
        var playerNames = {};
        if (gameui.gamedatas && gameui.gamedatas.players) {
          var players = gameui.gamedatas.players;
          for (var pid in players) {
            playerNames[pid] = players[pid].name;
          }
        }
        // Extract only the fields the pipeline needs from gamedatas.
        // The full object can contain non-cloneable values (DOM nodes,
        // functions) that would cause structured cloning to fail.
        var gamedatas = null;
        if (gameui.gamedatas) {
          gamedatas = {
            my_hand: gameui.gamedatas.my_hand || [],
            cards: gameui.gamedatas.cards || {},
          };
        }
        if (!result || !result.data) {
          resolve({ error: true, msg: "BGA API returned no notification data" });
          return;
        }
        resolve({
          players: playerNames,
          gamedatas: gamedatas,
          packets: result.data,
        });
      },
      function (is_error, error_msg) {
        resolve({ error: true, msg: error_msg });
      }
    );
  });
})();
