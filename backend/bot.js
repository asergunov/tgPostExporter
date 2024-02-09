const { Api, TelegramClient } = require("telegram");
const { NewMessage, NewMessageEvent } = require("telegram/events");
const { writeFile, existsSync, mkdirSync } = require("fs");
const { cwd } = require("process");
const path = require("path");
const { fileURLToPath } = require("url");

/**
 * @typedef {{
 *  mode: string|bool,
 *  links: RowList,
 *  duplicateLinks: RowList,
 *  listIndex: number,
 *  listPageLines: number}} ChatContext
 */
/**
 * @type {ChatContext}
 */
const defaultContext = {
  mode: false,
  duplicateLinks: {},
  links: {},
  listIndex: 0,
  listPageLines: 10,
};

/**
 * @type {Object.<number, ChatContext>}
 */
let chatContexts = Object.create(null);

/**
 * @typedef {{
 *  fullLink: string,
 *  channelName: string,
 *  postId: string,
 *  rawNotes: string[],
 *  notes: string[],
 *  fetchPhotos: boolean,
 *  photosPositions: string[]}} ParsedLink
 */

const linkRegExp =
  /(((t|telegram)\.me)|(tgstat\.ru\/channel))\/@?(?<link>[\/a-zA-Z0-9_\-\+]+)\/?/;
const notesRegExp = /([а-яА-ЯёЁ]+)/g;
const photosPositionRegExp = /\b\d\b/g;

/**
 *
 * @param {string} input
 * @returns {Map.<string, ParsedLink>}
 */
function parseLinkList(input) {
  const linksObject = new Map();
  const failedPosts = {};
  for (const row of input.split("\n")) {
    failedPosts.value = [];

    const { link } = row.match(linkRegExp)?.groups ?? { link: false };
    let fetchPhotos = false;
    let photosPositions = [];

    if (link) {
      const [channelName, postId] = link.split("/");
      const rawNotes = row?.match(notesRegExp);
      const indexOfPhotoNote = rawNotes?.indexOf(config.photoNote) ?? -1;

      if (indexOfPhotoNote !== -1) {
        rawNotes.splice(indexOfPhotoNote, 1);
        fetchPhotos = true;
        photosPositions = row.match(photosPositionRegExp) ?? [];
      }

      const notes =
        rawNotes?.map((note) => {
          const { after } =
            config.notes.find(({ before }) => note === before) ?? {};

          return after ?? note;
        }) ?? [];

      linksObject.set(link, {
        fullLink: `https://t.me/${link}`,
        channelName,
        postId,
        rawNotes: [
          ...(row?.match(notesRegExp) ?? []),
          ...(photosPositions ?? []),
        ],
        notes,
        fetchPhotos,
        photosPositions,
      });
    }
  }

  return linksObject;
}

/**
 * @typedef {string[]} RowList
 * @typedef {{links: RowList, duplicateLinks: RowList}} FormattedRows
 * @function
 * @returns {FormattedRows}
 */
function formatPosts() {
  const links = {};
  const processedLinks = [];
  const duplicateLinks = [];
  const rows = settings.inputText
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row !== "")
    .map((row) => row.replace(/s+/, " "))
    .filter((row, index, rows) => rows.indexOf(row) == index);
  let lastNotes = null;
  let lastPhotoPositions = null;

  for (const row of rows) {
    if (row.slice(0, 2) === "//") continue;

    const { link } = row.match(linkRegExp)?.groups ?? { link: false };
    const rowNotes = row.match(notesRegExp);
    const rowPhotoPositions = row.match(photosPositionRegExp);

    if (link) {
      if (!links[link] && !processedLinks.includes(link)) {
        links[link] = `https://t.me/${link} ${(
          rowNotes ??
          lastNotes ??
          defaultNotes.value ??
          []
        ).join(", ")} ${(rowPhotoPositions ?? lastPhotoPositions ?? []).join(
          " "
        )}`;
        processedLinks.push(link);
      } else {
        if (links[link]) {
          duplicateLinks.push(links[link]);
          delete links[link];
        }

        duplicateLinks.push(
          `https://t.me/${link} ${(
            rowNotes ??
            lastNotes ??
            defaultNotes.value ??
            []
          ).join(", ")} ${(rowPhotoPositions ?? lastPhotoPositions ?? []).join(
            " "
          )}`
        );
      }

      lastNotes = null;
      lastPhotoPositions = null;
    }

    /**
     * @typedef {{mode: string}} ChatContext
     */

    if (!link && !row.includes(":") && rowNotes) {
      lastNotes = rowNotes;
    }

    if (!link && !row.includes(":") && rowPhotoPositions) {
      lastPhotoPositions = rowPhotoPositions;
    }
  }

  duplicateLinks.sort();

  return { links: Object.values(links), duplicateLinks: duplicateLinks };
}

/**
 * @param {FormattedRows}
 */
void applyFormattedPostsToInputText({links, duplicateLinks})
{
  settings.inputText = [...links, "", ...duplicateLinks].join("\n")
}

class CommandResponder {
  /**
   * @callback CommandCallback
   * @param {NewMessageEvent} event
   * @param {ChatContext} context
   * @param {string} extra
   * @async
   */
  /**
   * @callback Callback
   * @param {NewMessageEvent} event
   * @param {ChatContext} context
   * @async
   */
  /**
   * @callback CommandFilter
   * @param {NewMessageEvent} event
   * @param {ChatContext} context
   * @returns {boolean}
   */
  /**
   * @typedef {{do: CommandCallback, desc?: string, filter: CommandFilter}} CommandDescriptor
   */

  /**
   * @param {{commands: Object.<string, CommandDescriptor>, fallback: Callback}}
   */
  constructor({ commands, fallback }) {
    this._commands = commands;
    this.fallback = fallback;
    this._regex = /^(\/[a-z]+)\b\s*(.*)?$/;
  }
  /**
   *
   * @param {NewMessageEvent} event
   */
  async respond(event) {
    const message = event.message.message;
    const chatId = Number(event.message.chatId);

    if (chatId in chatContexts === false) {
      chatContexts[chatId] = JSON.parse(JSON.stringify(defaultContext));
    }

    const context = chatContexts[chatId];
    const result = message.match(this._regex);
    if (!result || result[1] in this._commands === false) {
      return await this.fallback(event, context);
    }

    const command = this._commands[result[1]];
    if ("filter" in command && !command.filter(event, context)) {
      return await this.fallback(event, context);
    }

    return await command.do(event, context, result[2]);
  }

  describeAvailableCommands(event, context, filter) {
    return Object.entries(this._commands)
      .filter(([, { desc }]) => desc)
      .filter(([name]) => !filter || filter(name))
      .filter(([, { filter }]) => !filter || filter(event, context))
      .map(([command, { desc }]) => `${command} ${desc}`)
      .join("\n");
  }
}

async function doAuthorized(event, _do) {
  const chatId = Number(event.message.chatId);
  if (settings.isChatAuthorized(chatId)) return await _do();

  if (event.message.message.startsWith("/start")) {
    event.client.sendMessage(`Привет! Скажи пароль.`);
    return;
  }
  if (config.botAuthorizationPassword == event.message.text) {
    settings.setChatAuthorized(chatId);
    await event.client.sendMessage(event.chatId, {
      message: "Правильно",
    });
  } else {
    await event.client.sendMessage(event.chatId, {
      message: "Скажи пароль",
    });
  }
}

const describeInputText = async () => {
  return await settings.get_inputText().then((text) => {
    const lines = [...text].reduce((a, c) => a + (c === "\n" ? 1 : 0), 0);
    return `В списке строк ${lines}`;
  });
};

const LIST_MODES = ["/list", "/dup"];
const LISTING_COMMANDS = ["/prev", "/next"];

/**
 *
 * @param {ChatContext} context
 */
function isInListMode(context) {
  return LIST_MODES.indexOf(context.mode) >= 0;
}

/**
 *
 * @param {ChatContext} context
 */
function getPostsList(context) {
  switch (context.mode) {
    case "/list":
      return context.links;
    case "/dup":
      return context.duplicateLinks;
  }
}

/**
 *
 * @param {ChatContext} context
 */
function getRowList(context) {
  return Object.values(getPostsList(context));
}

/**
 *
 * @param {NewMessageEvent} event
 * @param {ChatContext} context
 * @returns
 */
function describeLinks(event, context) {
  const listIndex = context.listIndex;
  const rows = getRowList(context);
  return [
    ...(listIndex > 0 ? ["..."] : []),
    ...rows
      .map((msg, index) => `${index + 1}. ${msg}`)
      .slice(listIndex, listIndex + context.listPageLines),
    ...(listIndex + context.listPageLines < rows.length ? ["..."] : []),
    responder.describeAvailableCommands(
      event,
      context,
      (name) => LISTING_COMMANDS.indexOf(name) >= 0
    ),
  ].join("\n");
}

const responder = new CommandResponder({
  commands: {
    "/start": {
      do: async (event, context) => {
        await event.client.sendMessage(event.message.chatId, {
          message: `Привет! \n${responder.describeAvailableCommands(
            event,
            context
          )}`,
        });
      },
    },
    "/list": {
      desc: "Показать отформатированные ссылки",
      filter: (event, context) => Object.keys(context.links).length > 0,
      do: async (event, context) => {
        context.mode = "/list";
        context.listIndex = 0;
        await event.client.sendMessage(event.chatId, {
          message: describeLinks(event, context),
          linkPreview: false,
        });
      },
    },
    "/dup": {
      desc: "Показать дубликаты",
      filter: (event, context) =>
        Object.keys(context.duplicateLinks).length > 0,
      do: async (event, context) => {
        context.mode = "/dup";
        context.listIndex = 0;
        await event.client.sendMessage(event.chatId, {
          message: describeLinks(event, context),
          linkPreview: false,
        });
      },
    },
    "/end": {
      desc: "Завершить добавление",
      filter: (event, context) => context.mode == "/add",
      do: async (event) => {
        await event.client.sendMessage(event.chatId, {
          message: `Добавление завершено. ${await describeInputText()}. Можно добавить ещё /add, форматировать /format или выгрузить /csv`,
        });
      },
    },
    "/add": {
      desc: "Добавить ссылок",
      do: async (event, context) => {
        context.mode = "/add";
        await event.client.sendMessage(event.message.chatId, {
          message: "Добавляйте ссылки. Чтобы завершить /end",
        });
      },
    },
    "/csv": {
      desc: "Забрать отчет",
      do: async (event, context) => {
        linksObject = parseLinkList(settings.inputText, config);
        context.mode = "/csv";
        const folderName = (() => {
          const date = new Date().toLocaleDateString(
            event.message.sender.langCode || "ru"
          );
          let folderName = date;
          var index = 0;
          while (existsSync(`reports/${folderName}`)) {
            index = index + 1;
            folderName = `${date} (${index})`;
          }
          mkdirSync(`reports/${folderName}`);
          return folderName;
        })();

        await event.client.sendMessage(event.chatId, {
          message: `В списке нашлось ссылок ${linksObject.size}. Собираю в папку \`${folderName}\``,
        });

        const { posts, failedPosts } = await fetchPosts({
          linksList: linksObject,
          folderName: folderName,
        });

        if (posts.length > 0) {
          const csv = assembleCsv(posts);
          writeFile(`reports/${folderName}/report.csv`, csv, () => {});
          const buffer = Buffer.from(csv, "utf8");
          buffer.name = "report.csv";
          await event.client.sendFile(event.chatId, {
            file: buffer,
            message: "Вот файл с отчетом.",
          });
        } else {
          await event.client.sendMessage(event.chatId, {
            message: "Отчет пустой",
          });
        }
        if (failedPosts.length > 0) {
          const csv = assembleCsv(failedPosts);
          const buffer = Buffer.from(csv, "utf8");
          writeFile(`reports/${folderName}/failedReport.csv`, csv, () => {});
          await event.client.message(event.chatId, {
            message: `не удалось собрать ${failedPosts.length} постов`,
          });
        }
        context.mode = false;
      },
    },
    "/status": {
      desc: "Статус",
      do: async (event, context) => {
        const describeMode = () => {
          switch (context.mode) {
            case false:
              return "Ничего не происходит";
            case "/add":
              return "Добавляем ссылки";
            case "/csv":
              "Готовим csv";
          }
        };
        await event.client.sendMessage(event.message.chatId, {
          message: `Дела такие: ${describeMode()}. ${await describeInputText()}.`,
        });
      },
    },
    "/format": {
      desc: "Форматировать список",
      do: async (event, state) => {
        const formatted  = formatPosts();
        applyFormattedPostsToInputText(formatted)
        state.duplicateLinks = formatted.duplicateLinks;
        state.links = formatted.links;

        await event.client.sendMessage(event.chatId, {
          message: `Готово. ${await describeInputText()}. Ссылок ${
            links.length
          }. Дубликатов ${
            duplicateLinks.length
          }.\n${responder.describeAvailableCommands(
            event,
            state,
            (cmd) => LIST_MODES.indexOf(cmd) >= 0
          )}`,
        });
      },
    },
    "/next": {
      desc: "Вперёд",
      filter: (event, context) =>
        isInListMode(context) &&
        context.listIndex + context.listPageLines < getRowList(context).length,
      do: async (event, context) => {
        context.listIndex = Math.min(
          getRowList(context).length - 1,
          context.listIndex + context.listPageLines
        );
        await event.client.sendMessage(event.chatId, {
          message: describeLinks(event, context),
          linkPreview: false,
        });
      },
    },
    "/prev": {
      desc: "Назад",
      filter: (event, context) =>
        isInListMode(context) && context.listIndex > 0,
      do: async (event, context) => {
        context.listIndex = Math.max(
          0,
          context.listIndex - context.listPageLines
        );
        await event.client.sendMessage(event.chatId, {
          message: describeLinks(event, context),
          linkPreview: false,
        });
      },
    },
    '/del': {
      desc: 'Удалить',
      filter: (event, context) => isInListMode(context),
      do: (event, filter, extra) => {

      }
    }
  },
  fallback: async (event, context) => {
    if (context.mode === "/add") {
      settings.inputText = [settings.inputText, event.message.text].join("\n");
      await event.client.sendMessage(event.chatId, {
        message: `${await describeInputText()}. Чтобы завершить /end`,
      });
    }
  },
});
/**
 *
 * @param {TelegramClient} client
 */
exports.startBot = function (client) {
  client.setParseMode("md2");
  client.addEventHandler(
    /**
     *
     * @param {NewMessageEvent} event
     */
    async (event) => {
      await doAuthorized(event, async () => await responder.respond(event));
    },
    new NewMessage({})
  );

  client.addEventHandler(
    /**
     *
     * @param {Api.TypeUpdate} event
     */
    async (event) => {
      if (event instanceof Api.UpdateChatParticipant) {
        // Added to chat
      }
      console.log(event);
    }
  );
};

const { settings, config } = require("./settings");
const { fetchPosts, assembleCsv } = require("./server");
const { pathToFileURL } = require("url");
