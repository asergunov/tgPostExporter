const { Api, TelegramClient, client } = require("telegram");
const { NewMessage, NewMessageEvent } = require("telegram/events");
const { writeFile, existsSync, mkdirSync } = require("fs");

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
const applyFormattedPostsToInputText = ({ links, duplicateLinks }) =>
  (settings.inputText = [...links, "", ...duplicateLinks].join("\n"));

/**
 * @callback NewMessageCallback
 * @param {NewMessageEvent} event
 * @async
 */

class TelegramBotChat {
  #bot;
  #chat;
  #onNewMessage;

  /**
   *
   * @param {TelegramBot} bot
   * @param {*} chat
   * @param {{onNewMessage: NewMessageCallback}}
   */
  constructor(bot, chat, { onNewMessage }) {
    this.#bot = bot;
    this.#chat = chat;
    this.#onNewMessage = onNewMessage;
  }

  get bot() {
    return this.#bot;
  }
  get chat() {
    return this.#chat;
  }

  /**
   *
   * @param {NewMessageEvent} event
   */
  async processNewMessage(event) {
    return await this.#onNewMessage(event);
  }

  /**
   *
   * @param {import("telegram/client/messages").SendMessageParams} message
   * @returns {Api.Message}
   */
  async sendMessage(message) {
    return await this.bot.sendMessage(this.chat, message);
  }

  /**
   * Receiving next message in that chat
   * @param {number|undefined} ms
   */
  async nextNewMessage(ms) {
    return await this.#bot.nextNewMessage(this.#chat, ms);
  }
}

/**
 * @typedef {{commands?: CommandDescriptors;onNewMessage?: TelegramBotCommandsCallback;onUnknownCommand?: NewMessageCallback;onText?: NewMessageCallback;}} TelegramBotCommandsSettings
 */

/**
 * @callback CommandCallback
 * @param {NewMessageEvent} event
 * @param {string} extra
 * @async
 */

/**
 * @callback NewMessageCallback
 * @param {NewMessageEvent} event
 * @async
 */

/**
 * @callback CommandFilter
 * @param {NewMessageEvent} event
 * @returns {boolean}
 */

/**
 * @typedef {{on: CommandCallback, desc?: string, filter?: CommandFilter} | CommandCallback} CommandDescriptor
 * @typedef {Object.<string, CommandDescriptor>} CommandDescriptors
 */

/**
 * @callback TelegramBotCommandsCallback
 * @param {event: CommandDescriptors, onNewMessage: TelegramBotCommandsCallback, onUnknownCommand: NewMessageCallback, onText: NewMessageCallback }
 */
class TelegramBotCommands {
  #commands;
  #onUnknownCommand;
  #onText;
  #onNewMessage;
  static #regex = /^\/([a-z]+)\b\s*(.*)?$/m;

  /**
   *
   * @param {TelegramBotCommandsSettings}
   */
  constructor({ commands, onNewMessage, onUnknownCommand, onText }) {
    this.#commands = commands ?? {};
    this.#onUnknownCommand = onUnknownCommand ?? (() => {});
    this.#onText = onText ?? (() => {});

    this.#onNewMessage =
      onNewMessage ??
      (async ({ event, onNewMessage, onUnknownCommand, onText }) => {
        return await onNewMessage({
          event: event,
          onUnknownCommand: onUnknownCommand,
          onText: onText,
        });
      });
  }

  /**
   *
   * @param {{event: NewMessageEvent, onUnknownCommand: NewMessageCallback, onText: NewMessageCallback}} param0
   * @returns
   */
  async #processNewMessage({ event, onUnknownCommand, onText }) {
    const result =
      event.message.text?.match(TelegramBotCommands.#regex) ?? undefined;
    if (!result) {
      return await onText(event);
    }

    if (result[1] in this.#commands === false) {
      return await onUnknownCommand(event);
    }
    const command = this.#commands[result[1]];
    if (command.filter && !(await command.filter(event))) {
      return await onUnknownCommand(event);
    }
    return (await command.on(event, result[2])) ?? undefined;
  }

  /**
   *
   * @param {NewMessageEvent} event
   */
  async processNewMessage(event) {
    return await this.#onNewMessage({
      event: event,
      onNewMessage: async (...args) => await this.#processNewMessage(...args),
      onUnknownCommand: async (...args) =>
        await this.#onUnknownCommand(...args),
      onText: async (...args) => this.#onText(...args),
    });
  }

  /**
   *
   * @param {*} event
   * @param {*} filter
   * @returns {string}
   */
  describeAvailableCommands(event, filter) {
    return Object.entries(this.#commands)
      .filter(([name]) => !filter || filter(name))
      .filter(([, { filter }]) => !filter || filter(event))
      .filter(([, { desc }]) => desc)
      .map(([command, { desc }]) => `/${command} ${desc}`)
      .join("\n");
  }
}

class TelegramBot {
  /**
   * @type {Map.<*, TelegramBotChat>}
   */
  #chats = new Map();

  /**
   * @type {NewMessageCallback}
   */
  #onNewMessage;

  /**
   * @param {{client: TelegramClient, onChat: NewMessageCallback}}
   */
  constructor({ client, onChat }) {
    this.#onNewMessage = async (event) => {
      if (!this.#chats.has(event.chatId.toString()))
        this.#chats.set(event.chatId.toString(), await onChat(event));
      const chat = this.#chats.get(event.chatId.toString());
      await chat.processNewMessage(event);
    };
    client.addEventHandler(async (event) => {
      return await this.#onNewMessage(event);
    }, new NewMessage({}));
  }

  /**
   * Receiving next message in that chat
   * @param {number|undefined} ms
   * @returns {Promise.<NewMessageEvent>}
   */
  nextNewMessage(chat, ms) {
    return new Promise((resolve, reject) => {
      const old = this.#onNewMessage;
      this.#onNewMessage = (event) => {
        if (event.chat != chat) old(event);
        else {
          this.#onNewMessage = old;
          resolve(event);
        }
      };
      if (ms !== undefined) {
        setTimeout(() => {
          this.#onNewMessage = old;
          reject();
        }, ms);
      }
    });
  }
}

const LIST_MODES = ["/list", "/dup"];
const LISTING_COMMANDS = ["prev", "next"];

class LinkListEditor {
  #listIndex = 0;
  #listPageLines = 10;
  #list;
  #onEdit;
  /**
   * @type {Api.Message}
   */
  #message;
  #buttons;

  /**
   * @typedef {TelegramBotCommandsSettings & {event: NewMessageEvent, list: Array.<string>, onEdit: async ()=>void}} LinkListEditorSettings
   * @param {LinkListEditorSettings} settings
   */
  constructor({ event, list, onEdit, ...settings }) {
    this.#onEdit = onEdit;
    this.#list = list;
  }

  /**
   *
   * @param {NewMessageEvent} event
   */
  async exec(event) {
    const backup = [...this.#list];

    const buttons = [
      [
        Button.inline("<", Buffer.from("/prev")),
        Button.inline(">", Buffer.from("/next")),
      ],
      [
        Button.inline("Done", Buffer.from("/done")),
        Button.inline("Cancel", Buffer.from("/cancel")),
      ],
    ];

    let resolve;
    const waitDone = new Promise((_resolve, rejects) => {
      resolve = _resolve;
    });

    const next = async () => {
      this.#listIndex = Math.min(
        this.#list.length - 1,
        this.#listIndex + this.#listPageLines
      );
      await message.edit({
        buttons: buttons,
        text: this.#describeLinks(event),
        linkPreview: false,
      });
    };

    const prev = async () => {
      this.#listIndex = Math.max(0, this.#listIndex - this.#listPageLines);
      await message.edit({
        buttons: buttons,
        text: this.#describeLinks(event),
        linkPreview: false,
      });
    };

    const done = async () => {
      const undoButton = Button.inline("Revert", Buffer.from("/undo"));
      await this.#onEdit(event);
      await message.edit({
        text: "Список отредактирован",
        buttons: undoButton,
      });

      /**
       *
       * @param {CallbackQueryEvent} callbackEvent
       */
      const eventHandler = async (callbackEvent) => {
        if (callbackEvent.data.toString() != "/undo") return;
        [...this.#list] = [...backup];
        this.#onEdit(event);
        message.delete({ revoke: true });
        event.client.removeEventHandler(eventHandler, eventType);
      };
      const eventType = new CallbackQuery({
        chats: [event.chatId],
        func: (event) => {
          return event.messageId == message.id;
        },
      });

      event.client.addEventHandler(eventHandler, eventType);

      resolve();
    };

    const cancel = async () => {
      await message.delete({ revoke: true });
      resolve();
    };
    /**
     *
     * @param {CallbackQueryEvent} callbackEvent
     */
    const eventHandler = async (callbackEvent) => {
      switch (callbackEvent.data.toString()) {
        case "/prev":
          return await prev();
          break;
        case "/next":
          return await next();
        case "/done":
          return await done();
        case "/cancel":
          return await cancel();
      }
    };
    const eventType = new CallbackQuery({
      chats: [event.chatId],
      func: (event) => {
        return event.messageId == message.id;
      },
    });

    event.client.addEventHandler(eventHandler, eventType);

    const message = await event.message.respond({
      message: this.#describeLinks(event),
      linkPreview: false,
      buttons: buttons,
    });

    await waitDone;

    event.client.removeEventHandler(eventHandler, eventType);
  }

  /**
   *
   * @param {NewMessageEvent} event
   * @returns
   */
  #describeLinks(event) {
    const listIndex = this.#listIndex;
    return [
      ...(listIndex > 0 ? ["..."] : []),
      ...this.#list
        .map((msg, index) => `${index + 1}. ${msg}`)
        .slice(listIndex, listIndex + this.#listPageLines),
      ...(listIndex + this.#listPageLines < this.#list.length ? ["..."] : []),
    ].join("\n");
  }

  /**
   *
   * @param {string} input
   */
  #indicesFromInput(input) {
    [...input.matchAll(/\b\d+\b/)].map((s) => Number(s));
  }

  /**
   *
   * @param {Array.<number>} indicesToDelete
   */
  #deleteFromList(indicesToDelete) {
    indicesToDelete
      .sort()
      .reverse()
      .forEach((index) => {
        if (index >= 0 && index < this.#list.length) {
          delete this.#list[index];
        }
      });
  }

  /**
   *
   * @param {NewMessageEvent} event
   * @param {Array.<number>} indicesToDelete
   */
  async #deleteFromListAndReply(event, indicesToDelete) {
    this.#deleteFromList(indicesToDelete);
    await this.#onEdit(event);
    await event.client.sendMessage(event.chatId, { message: `Готово` });
  }
}

class BotChat extends TelegramBotChat {
  #mode = false;
  #links = {};
  #duplicateLinks = {};
  #commands;

  constructor(bot, chat) {
    super(bot, chat, {
      onNewMessage: async (event) => {
        return await this.#commands.processNewMessage(event);
      },
    });

    this.#commands = new TelegramBotCommands({
      commands: {
        start: {
          on: async (event) => {
            const reply = await event.message.respond({
              message: `Привет! \n${this.#commands.describeAvailableCommands(
                event
              )}`, 
            });
          },
        },
        list: {
          desc: "Показать отформатированные ссылки",
          filter: () => Object.keys(this.#links).length > 0,
          on: async (event) => {
            return await this.#editList(event, this.#links);
          },
        },
        dup: {
          desc: "Показать дубликаты",
          filter: () => Object.keys(this.#duplicateLinks).length > 0,
          on: async (event) => {
            return await this.#editList(event, this.#duplicateLinks);
          },
        },
        end: {
          desc: "Завершить добавление",
          filter: () => this.#mode == "/add",
          on: async (event) => {
            await event.client.sendMessage(event.chatId, {
              message: `Добавление завершено. ${await this.#describeInputText()}. Можно добавить ещё /add, форматировать /format или выгрузить /csv`,
            });
          },
        },
        add: {
          desc: "Добавить ссылок",
          on: async (event, extra) => {
            if (extra) {
              settings.inputText += "\n" + extra;
              await event.client.invoke(
                new Api.messages.SendReaction({
                  peer: event.client.getInputEntity(event.chatId),
                  msgId: event.messageId,
                  // reaction: ["☑️"],
                  reaction: ":)",
                })
              );
              return;
            }
            this.#mode = "/add";
            await event.client.sendMessage(event.message.chatId, {
              message: "Добавляйте ссылки. Чтобы завершить /end",
            });
          },
        },
        csv: {
          desc: "Забрать отчет",
          on: async (event) => {
            linksObject = parseLinkList(settings.inputText, config);
            this.#mode = "/csv";
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
              writeFile(
                `reports/${folderName}/failedReport.csv`,
                csv,
                () => {}
              );
              await event.client.message(event.chatId, {
                message: `не удалось собрать ${failedPosts.length} постов`,
              });
            }
            this.#mode = false;
          },
        },
        status: {
          desc: "Статус",
          on: async (event) => {
            const describeMode = () => {
              switch (this.#mode) {
                case false:
                  return "Ничего не происходит";
                case "/add":
                  return "Добавляем ссылки";
                case "/csv":
                  "Готовим csv";
              }
            };
            await event.client.sendMessage(event.message.chatId, {
              message: `Дела такие: ${describeMode()}. ${await this.#describeInputText()}.`,
            });
          },
        },
        format: {
          desc: "Форматировать список",
          on: async (event) => {
            const formatted = formatPosts();
            applyFormattedPostsToInputText(formatted);
            this.#duplicateLinks = formatted.duplicateLinks;
            this.#links = formatted.links;

            await event.client.sendMessage(event.chatId, {
              message: `Готово. ${await this.#describeInputText()}. ${this.#describeFormattedLinks()}.\n${this.#commands.describeAvailableCommands(
                event,
                (cmd) => LIST_MODES.indexOf(cmd) >= 0
              )}`,
            });
          },
        },
      },
    });
  }

  async #describeInputText() {
    return await settings.get_inputText().then((text) => {
      const lines = [...text].reduce((a, c) => a + (c === "\n" ? 1 : 0), 0);
      return `В списке строк ${lines}`;
    });
  }

  #describeFormattedLinks() {
    return `Ссылок ${this.#links.length}. Дубликатов ${
      this.#duplicateLinks.length
    }`;
  }

  async #editList(event, list) {
    const listCommands = new LinkListEditor({
      event: event,
      list: list,
      onEdit: () => {
        applyFormattedPostsToInputText({
          links: this.#links,
          duplicateLinks: this.#duplicateLinks,
        });
      },
      onUnknownCommand: (event) => {
        done = this.#commands.processNewMessage(event);
      },
    });
    await listCommands.exec(event);
  }
}

class Bot extends TelegramBot {
  constructor(client) {
    super({
      client: client,
      onChat: async (event) => {
        while (!(await settings.isChatAuthorized(event.chatId))) {
          if (event.message.text == config.botAuthorizationPassword) break;

          const password_request_message = await event.message.respond({
            message: "Нужен пароль",
            buttons: [
              [Button.inline("1"), Button.inline("2"), Button.inline("3")],
              [Button.inline("4"), Button.inline("5"), Button.inline("6")],
              [Button.inline("7"), Button.inline("8"), Button.inline("9")],
              [Button.inline("Del"), Button.inline("0"), Button.inline("OK")],
            ],
          });

          await new Promise((resolve, reject) => {
            let pass = "";
            /**
             *
             * @param {CallbackQueryEvent} event
             */
            const callback = async (event) => {
              const dataStr = event.data.toString();
              if (dataStr === "Del") pass = pass.slice(0, -1);
              else if (dataStr === "OK") {
                if (pass == config.botAuthorizationPassword) {
                  await settings.setChatAuthorized(event.chatId);
                  await event.client.editMessage(
                    password_request_message.chatId,
                    {
                      buttons: Button.clear(),
                      message: password_request_message.id,
                      text: "Правильно",
                    }
                  );
                  resolve();
                } else {
                  await event.client.editMessage(
                    password_request_message.chatId,
                    {
                      buttons: Button.clear(),
                      message: password_request_message.id,
                      text: "Не правильно. Попробуйте через 5 секунд.",
                    }
                  );
                  setTimeout(resolve, 5000);
                }
                event.client.removeEventHandler(callback, query);
                return;
              } else pass += dataStr;
              event.answer({ message: `Pass: ${pass}` });
            };
            const query = new CallbackQuery({
              func: (event) => event.messageId === password_request_message.id,
            });
            event.client.addEventHandler(callback, query);
          });
        }
        return new BotChat(this, event.chat);
      },
    });
  }
}

/**
 *
 * @param {TelegramClient} client
 */
exports.startBot = function (client) {
  return new Bot(client);
};

const { settings, config } = require("./settings");
const { fetchPosts, assembleCsv } = require("./server");
const {
  message: password_request_message,
  message,
} = require("telegram/client");
const { eventNames } = require("process");
const { Button } = require("telegram/tl/custom/button");
const { text } = require("input");
const {
  CallbackQuery,
  CallbackQueryEvent,
} = require("telegram/events/CallbackQuery");
const { resolve } = require("path");
const { rejects } = require("assert");
const { buildReplyMarkup } = require("telegram/client/buttons");
