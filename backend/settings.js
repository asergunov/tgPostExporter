const { readFileSync } = require("fs");

const settings = require("node-persist");
settings.initSync({
  dir: 'data/settings'  
});

KEYS = {
  inputText: "",
  botToken: "",
  userSession: "",
  botSession: "",
};

Object.entries(KEYS).forEach(([key, defaultValue]) => {
  Object.defineProperty(settings, "get_" + key, {
    value: async function () {
      return await this.get(key) ?? defaultValue;
    },
  });
  Object.defineProperty(settings, "set_" + key, {
    value: function (value) {
      return this.set(key, value);
    },
  });
  Object.defineProperty(settings, key, {
    get: function () {
      return this.getItemSync(key) ?? defaultValue;
    },
    set: function (value) {
      return this.setItemSync(key, value ?? defaultValue);
    },
  });
});

Object.entries({
  isChatAuthorized: function (chatId) {
    return this.get(`isChatAuthorized_${chatId}`) ?? false;
  },
  setChatAuthorized: function (chatId) {
    return this.set(`isChatAuthorized_${chatId}`, true);
  },
}).forEach(([key, value]) => {
  Object.defineProperty(settings, key, {value: value});
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
exports.settings = settings