const { mkdirSync, existsSync } = require("fs");
const { getPosts, getMessages, getPhoto } = require('./telegram');
const { log } = require('console');
const { TotalList } = require("telegram/Helpers");


/**
 * 
 * @param {import("telegram").Api.Message[]} messages 
 * @param {string} fullLink 
 * @param {boolean} fetchPhotos 
 * @param {*} notes 
 * @param {*} rawNotes 
 * @param {[string]} photosPositions 
 * @param {string} folderName 
 * @returns 
 */
async function formatMessage(
    messages,
    fullLink,
    fetchPhotos,
    notes,
    rawNotes,
    photosPositions,
    folderName
  ) {
    const [{ message, media, date, fwdFrom }, ...restMessages] = messages;
  
    const formattedMessage = [message ?? ""];
  
    if (media) {
      const { photo, webpage } = media;
  
      if (photo && fetchPhotos) {
        if (photosPositions.includes("1") || photosPositions.length === 0) {
          const photoId = await getPhoto(photo, folderName);
          formattedMessage.push(
            `http://${host}:${port}/images/${folderName}/${photoId}.jpg`
          );
        }
  
        try {
          for (const {
            media: { photo },
          } of restMessages) {
            const photoId = await getPhoto(photo, folderName);
            formattedMessage.push(
              `http://${host}:${port}/images/${folderName}/${photoId}.jpg`
            );
          }
        } catch (error) {
          return {
            result: false,
            post: {
              fullLink,
              notes: rawNotes,
            },
          };
        }
      }
  
      if (webpage) {
        const { siteName = "", title = "", description = "" } = webpage;
        formattedMessage.push(siteName, title, description);
      }
    }
  
    let forwardedFrom = null;
    if (fwdFrom) {
      if (fwdFrom.fromId) {
        if (fwdFrom.fromId.className === "PeerUser") {
          const fwdUserId = Number(fwdFrom.fromId.userId);
          const { firstName, lastName } = users.filter(
            ({ id }) => id == fwdUserId
          )[0];
  
          forwardedFrom = `${firstName} ${lastName}`;
        }
        if (fwdFrom.fromId.className === "PeerChannel") {
          const fwdChannelId = Number(fwdFrom.fromId.channelId);
  
          if (otherChats) {
            const { title } = otherChats.filter(
              ({ id }) => id == fwdChannelId
            )[0];
  
            forwardedFrom = title;
          } else {
            forwardedFrom = title;
          }
        }
      } else forwardedFrom = fwdFrom.fromName;
    }
  
    return {
      result: true,
      post: {
        title,
        forwardedFrom,
        message: formattedMessage.join("\n").replace(/^\s*$(?:\r\n?|\n)/gm, ""),
        date: formatDateString(date),
        fullLink,
        notes,
      },
    };
  };
