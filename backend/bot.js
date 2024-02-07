const { Api, TelegramClient } = require("telegram");
const { NewMessage, NewMessageEvent } = require("telegram/events");

/**
 * @typedef {{
 *  notes: {before: string, after: string}, 
 *  photoNote: string,
 *  defaultNotes: string,
 *  inputText: string,
 *  apiId: string,
 *  apiHash: string,
 *  sessionString: string,
 *  botToken: string,
 *  botAuthorizationPassword: string}} SettingsStore
 */

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

/**
 * 
 * @param {string} input 
 * @param {SettingsStore} settingsStore 
 * @returns {Object.<string, ParsedLink>}
 */
function parseLinkList(input, settingsStore) {
    const linkRegExp = /(((t|telegram)\.me)|(tgstat\.ru\/channel))\/@?(?<link>[\/a-zA-Z0-9_\-\+]+)\/?/
    const notesRegExp = /([а-яА-ЯёЁ]+)/g

    const linksObject = {}
    const failedPosts = {}
    for (const row of input.split('\n')) {
      failedPosts.value = []
  
      const { link } = row.match(linkRegExp)?.groups ?? { link: false }
      let fetchPhotos = false
      let photosPositions = []
  
      if (link) {
        const [channelName, postId] = link.split('/')
        const rawNotes = row?.match(notesRegExp)
        const indexOfPhotoNote = rawNotes?.indexOf(settingsStore.photoNote) ?? -1
  
        if (indexOfPhotoNote !== -1) {
          rawNotes.splice(indexOfPhotoNote, 1)
          fetchPhotos = true
          photosPositions = row.match(photosPositionRegExp) ?? []
        }
  
        const notes =
          rawNotes?.map((note) => {
            const { after } = settingsStore.notes.find(({ before }) => note === before) ?? {}
  
            return after ?? note
          }) ?? []
  
        linksObject[link] = {
          fullLink: `https://t.me/${link}`,
          channelName,
          postId,
          rawNotes: [...(row?.match(notesRegExp) ?? []), ...(photosPositions ?? [])],
          notes,
          fetchPhotos,
          photosPositions
        }
      }
    }
  
    return linksObject
  }

/**
 * 
 * @param {TelegramClient} client 
 */
exports.startBot = function (client, settingsStore)
{
    let authorizedChatIds = [];
    client.addEventHandler(
        /**
         * 
         * @param {NewMessageEvent} event 
         */
        async (event) => {
            const chatId = Number(event.message.chatId);
            if (event.message.message.startsWith("/start")) {
                await client.sendMessage(chatId, {
                    message: "Please enter password",
                });
                return
            }

            if(!authorizedChatIds[chatId])
            {
                if(settingsStore.botAuthorizationPassword == event.message.text)
                {
                    authorizedChatIds[chatId] = true;
                    await client.sendMessage(chatId, {
                        message: "Authorized",
                    });    
                } else {
                    await client.sendMessage(chatId, {
                        message: "Please authorize",
                    });
                }
                return;
            }

            linksObject = parseLinkList(event.message.rawText, settingsStore)
            await client.sendMessage(chatId, {
                message: "Found " + Object.keys(linksObject).length,
            });           
            const { posts, failedPosts } = await fetchPosts({ linksList: Object.values(linksObject), folderName: "temp" });
            if(posts) {
              const buffer = Buffer.from(assembleCsv(posts), 'utf8')
              buffer.name = "report.csv";
              await client.sendFile(chatId, {
                file: buffer,
              });
            } else {
              await client.sendMessage(chatId, {
                message: "Unsuccessful"})
            }
            if(failedPosts) 
            {
              const buffer = Buffer.from(assembleCsv(failedPosts), 'utf8')
              buffer.name = "failedReport.csv";
              await client.sendFile(chatId, {
                file: buffer,
              });
            }
     }, new NewMessage({}));
  
     client.addEventHandler(
        /**
         * 
         * @param {Api.TypeUpdate} event 
         */
        async (event) => {
        if( event instanceof Api.UpdateChatParticipant)
        {
            // Added to chat
        }
        console.log(event);
     });
}


const { fetchPosts, assembleCsv } = require('./posts');