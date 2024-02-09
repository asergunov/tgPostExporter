const { log } = require('console');
const { writeFileSync, readFileSync } = require('fs');
const { startBot } = require('./bot');

const {
  Api: {
    channels: { GetMessages },
    InputPhotoFileLocation,
  },
  TelegramClient,
} = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const { settings, config } = require('./settings');

/**
 * @type {TelegramClient}
 */
let client = {};

(async () => {
  let apiId = config.apiId,
    apiHash = config.apiHash,
    sessionString = config.sessionString;

  if (!(config.apiId && config.apiHash)) {
    log(`Не хватает данных для авторизации
1. Залогинься на https://my.telegram.org/apps
2. Нажми на API Development tools
3. На странице создания приложения заполни только поля App title и Short name
4. Создай приложение
5. Скопируй (с помощью нажатия правой кнопкой мыши по полю ввода) необходимые значения со страницы сюда`);
  }

  if (!config.apiId) apiId = await input.text('Скопируйте и вставьте сюда ваш api_id ');
  if (!config.apiHash) apiHash = await input.text('Скопируйте и вставьте сюда ваш api_hash ');

  sessionString = new StringSession(sessionString);

  client = new TelegramClient(sessionString, Number(apiId), apiHash, {
    connectionRetries: 5,
  });
  client.setLogLevel('error');
  if (config.botToken) {
    await client.start({botAuthToken: config.botToken});
    startBot(client);
    await settings.set_botSession(client.session.save());
  }
  else {
    await client.start({
      phoneNumber: async () => await input.text('Номер телефона с кодом страны '),
      password: async () => await input.text('Пароль '),
      phoneCode: async () => await input.text('Код подтверждения '),
      onError: (err) => console.log(err),
    });
    await settings.set_userSession(client.session.save());
  }
  
  log('Авторизация прошла успешно, можно работать');
})();

exports.getPhoto = async ({ id, accessHash, fileReference, dcId }, folderName) => {
  try {
    const buffer = await client.downloadFile(
      new InputPhotoFileLocation({
        id,
        accessHash,
        fileReference,
        thumbSize: 'i',
      }),
      {
        dcId,
      }
    );

    writeFileSync(`reports/${folderName}/${id}.jpg`, buffer);

    return id;
  } catch {}
};

exports.getPosts = async (channelName, postIds, fullLink) => {
  try {
    const post = await client.invoke(
      new GetMessages({
        channel: channelName,
        id: postIds,
      })
    );

    if (post.messages[0].className === 'MessageEmpty') return false;

    return post;
  } catch (e) {
    log(e);
  }

  return false;
};

exports.getMessages = async (channelName, postIds, fullLink) => {
  return client.getMessages(channelName, {
    ids: postIds,
    limit: postIds.length,
  });
}
