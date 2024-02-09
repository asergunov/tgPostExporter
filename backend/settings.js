const { readFileSync } = require("fs");

storage = require("node-persist");
storage.initSync();

KEYS = {
  inputText: "inputText",
  botToken: "botToken",
  userSession: "userSession",
  botSession: "botSession",
};

Object.entries(KEYS).forEach(([prop, key]) => {
  Object.defineProperty(storage, "get_" + prop, {
    value: function () {
      return this.get(key);
    },
  });
  Object.defineProperty(storage, "set_" + prop, {
    value: function (value) {
      return this.set(key, value);
    },
  });
  Object.defineProperty(storage, prop, {
    get: function () {
      return this.getItemSync(key);
    },
    set: function (value) {
      return this.setItemSync(key, value);
    },
  });
});

Object.entries({
  isChatAuthorized: function (chatId) {
    return this.get(`isChatAuthorized_${chatId}`);
  },
  setChatAuthorized: function (chatId) {
    return this.set(`isChatAuthorized_${chatId}`, true);
  },
}).forEach(([key, value]) => {
  Object.defineProperty(storage, key, {value: value});
});


/**
 * @typedef {{
*  notes: {before: string, after: string},
*  photoNote: string,
*  defaultNotes: string,
*  apiId: string,
*  apiHash: string,
*  sessionString: string,
*  botToken: string,
*  botAuthorizationPassword: string}} Config
*/
/**
 * @type {Config}
 */
exports.config = JSON.parse(readFileSync("settings.json", "utf8"));
exports.settings = storage