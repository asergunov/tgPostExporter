const { mkdirSync, existsSync } = require("fs");
const { getPosts, getPhoto } = require('./telegram');
const { log } = require('console');

function formatDateString(date) {
  const dateObject = new Date(date * 1000);
  const dateArray = [
    dateObject.getFullYear(),
    dateObject.getMonth() + 1,
    dateObject.getDate(),
    dateObject.getHours(),
    dateObject.getMinutes(),
  ];

  return dateArray.map((date) => date.toString().padStart(2, "0")).join("");
}

async function formatPost(
  rawPost,
  fullLink,
  fetchPhotos,
  notes,
  rawNotes,
  photosPositions,
  folderName
) {
  const {
    chats: [{ title }, ...otherChats],
    messages: [{ message, media, date, fwdFrom }, ...restMessages],
    users,
  } = rawPost;

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

exports.fetchPosts = async ({ linksList, folderName }) => {
  if (!existsSync(`reports/${folderName}`)) {
    mkdirSync(`reports/${folderName}`);
  }

  const posts = [];
  const failedPosts = [];

  for (const {
    fullLink,
    channelName,
    postId,
    notes,
    rawNotes,
    fetchPhotos,
    photosPositions,
  } of linksList) {
    if (channelName === "c") {
      failedPosts.push({
        fullLink,
        notes: rawNotes,
      });
      log(`Ошибка при сборе поста: ${fullLink}`);
      continue;
    }

    let postIds;

    // Форматируем id постов
    if (photosPositions.length > 0)
      postIds = [
        Number(postId),
        ...photosPositions.map(
          (position) => Number(postId) + Number(position) - 1
        ),
      ];
    else postIds = [Number(postId)];

    // Получаем пост из телеграма
    const rawPost = await getPosts(channelName, postIds, fullLink);

    if (!rawPost) {
      failedPosts.push({
        fullLink,
        notes: rawNotes,
      });
      log(`Ошибка при сборе поста: ${fullLink}`);
      continue;
    }

    const { result, post: formattedPost } = await formatPost(
      rawPost,
      fullLink,
      fetchPhotos,
      notes,
      rawNotes,
      photosPositions,
      folderName
    );

    if (result) {
      posts.push(formattedPost);
      log(`Успешно собран пост: ${fullLink}`);
    } else {
      failedPosts.push(formattedPost);
      log(`Ошибка при сборе поста: ${fullLink}`);
    }
  }

  log("Сбор постов завершен");
  return { posts, failedPosts };
};

exports.assembleCsv = function (posts) {
  log("Начал собирать таблицу");

  const delimeter = "\t";
  let header = `Автор${delimeter}Repost${delimeter}Дата${delimeter}Сообщение${delimeter}Ссылка`;
  let maximumNotesPerRow = 0;
  const rows = [];

  for (const {
    title,
    forwardedFrom,
    date,
    message,
    fullLink,
    notes,
  } of posts) {
    let row = [];

    row.push(title ?? "");
    row.push(forwardedFrom ?? "");
    row.push(date ?? "");
    row.push(message?.replace(/\n/gm, " NEWLINE ") ?? "");
    row.push(fullLink);

    if (notes) {
      row.push(...notes);
      maximumNotesPerRow =
        notes.length > maximumNotesPerRow ? notes.length : maximumNotesPerRow;
    }

    rows.push(row.join(delimeter));
  }

  for (let i = 1; i <= maximumNotesPerRow; i++) {
    if (i === 1) header += `${delimeter}Категория`;
    else if (i === 2) header += `${delimeter}Подкатегория`;
    else header += `${delimeter}Note${i}`;
  }
  header += "\n";

  log("Закончил собирать таблицу");
  return header + rows.join("\n");
}
