const { createServer, IncomingMessage, ServerResponse } = require('http');
const { writeFile, mkdirSync, existsSync, readFile } = require('fs');
const { log } = require('console');
const { exec } = require('child_process');
const util = require('util');
const process = require('process');

var cache = require('persistent-cache');
var postsCache = cache({base: 'data/cache', name: 'posts'});

const contentTypes = {
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
  js: 'text/javascript',
  json: 'application/json',
  html: 'text/html',
  css: 'text/css',
  plain: 'text/plain',
};

/**
 * 
 * @param {IncomingMessage} req 
 * @param {ServerResponse} res 
 */
async function requestListener(req, res) {
  const [route, folderName, fileName] = req.url.slice(1).split('/');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  let bodyChunks = [];

  req
    .on('data', (chunk) => {
      bodyChunks.push(chunk);
    })
    .on('end', async () => {
      const body = Buffer.concat(bodyChunks).toString();

      if (route === '') {
        readFile('front/index.html', (err, data) => {
          if (!err) {
            res.setHeader('Content-Type', contentTypes.html);
            res.writeHead(200);
            res.end(data);
          } else {
            res.writeHead(404);
            res.end();
          }
        });
        return;
      }

      if (route === 'posts') {
                if (req.headers['content-type'] === contentTypes.json) {
          const parsedBody = JSON.parse(body);
          const { posts, failedPosts } = await fetchPosts(parsedBody);

          writeFile(`reports/${parsedBody.folderName}/report.csv`, assembleCsv(posts), () => {});
          writeFile(`reports/${parsedBody.folderName}/failedReport.csv`, assembleCsv(failedPosts), () => {});

          res.setHeader('Content-Type', contentTypes.json);
          res.writeHead(200);
          res.end(JSON.stringify(failedPosts));
        } else {
                    res.writeHead(200);
          res.end();
        }
        return;
      }

      if (route === 'images' || route === 'assets') {
        let path, ext;

        if (route === 'assets') {
          path = `front/assets/${folderName}`;
          ext = folderName.split('.')[1];
        }

        if (route === 'images') {
          path = `reports/${folderName}/${fileName}`;
          ext = fileName.split('.')[1];
        }

        readFile(path, (err, data) => {
          if (!err) {
            res.setHeader('Content-Type', contentTypes[ext]);
            res.writeHead(200);
            res.end(data);
          } else {
            log(err);
            res.writeHead(404);
            res.end();
          }
        });
        return;
      }

      if (route === 'settings') {
        const allowedMethods = ['GET', 'HEAD']
        res.setHeader('Allow', allowedMethods.join(', '))
        if(allowedMethods.includes(req.method) === false) {
          return res.writeHead(405).res.end();
        }
        res.setHeader('Content-Type', contentTypes.json).writeHead(200);
        if(req.method == 'GET') {
          return res.end(JSON.stringify(config));
        }
        return res.end();
      }

      if (route === 'input_text')
      {
        const allowedMethods = ['GET', 'HEAD', 'POST']
        res.setHeader('Allow', allowedMethods.join(', '))
        if(allowedMethods.includes(req.method) === false) {
          return res.writeHead(405).end();
        }
        res.setHeader('Content-Type', contentTypes.plain)
        try {
          if(req.method === 'POST') {
            await settings.set_inputText(body);
          }
          if(req.method === 'GET') {
            value = await settings.get_inputText();
            return res.writeHead(200).end(value);
          }
        } catch(error) {
          return res.writeHead(500, error);
        }
        return res.writeHead(200).end()
      }

      if (route === 'ping') {
        res.writeHead(200);
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
      return;
    });
}

function formatDateString(date) {
  const dateObject = new Date(date * 1000);
  const dateArray = [dateObject.getFullYear(), dateObject.getMonth() + 1, dateObject.getDate(), dateObject.getHours(), dateObject.getMinutes()];

  return dateArray.map((date) => date.toString().padStart(2, '0')).join('');
}

/**
 * @typedef {{result: boolean,
    post: {
      title: string,
      forwardedFrom : string,
      message: string,
      date: string,
      fullLink: string,
      notes: string[],
    },
  }} FormattedPost 
 */

/**
 * 
 * @param {*} rawPost 
 * @param {*} fullLink 
 * @param {*} fetchPhotos 
 * @param {*} notes 
 * @param {*} rawNotes 
 * @param {*} photosPositions 
 * @param {*} folderName 
 * @returns {FormattedPost}
 */

async function formatPost(rawPost, fullLink, fetchPhotos, notes, rawNotes, photosPositions, folderName) {
  const {
    chats: [{ title }, ...otherChats],
    messages: [{ message, media, date, fwdFrom }, ...restMessages],
    users,
  } = rawPost;

  const formattedMessage = [message ?? ''];

  if (media) {
    const { photo, webpage } = media;

    if (photo && fetchPhotos) {
      if (photosPositions.includes('1') || photosPositions.length === 0) {
        const photoId = await getPhoto(photo, folderName);
        formattedMessage.push(`http://${host}:${port}/images/${folderName}/${photoId}.jpg`);
      }

      try {
        for (const {
          media: { photo },
        } of restMessages) {
          const photoId = await getPhoto(photo, folderName);
          formattedMessage.push(`http://${host}:${port}/images/${folderName}/${photoId}.jpg`);
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
      const { siteName = '', title = '', description = '' } = webpage;
      formattedMessage.push(siteName, title, description);
    }
  }

  let forwardedFrom = null;
  if (fwdFrom) {
    if (fwdFrom.fromId) {
      if (fwdFrom.fromId.className === 'PeerUser') {
        const fwdUserId = Number(fwdFrom.fromId.userId);
        const { firstName, lastName } = users.filter(({ id }) => id == fwdUserId)[0];

        forwardedFrom = `${firstName} ${lastName}`;
      }
      if (fwdFrom.fromId.className === 'PeerChannel') {
        const fwdChannelId = Number(fwdFrom.fromId.channelId);

        if (otherChats) {
          const { title } = otherChats.filter(({ id }) => id == fwdChannelId)[0];

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
      message: formattedMessage.join('\n').replace(/^\s*$(?:\r\n?|\n)/gm, ''),
      date: formatDateString(date),
      fullLink,
      notes,
    },
  };
}

async function fetchPosts({ linksList, folderName }) {
  if (!existsSync(`reports/${folderName}`)) {
    mkdirSync(`reports/${folderName}`);
  }

  /**
   * @type FormattedPost[]
   */
  const posts = [];
  /**
   * @type FormattedPost[]
   */
  const failedPosts = [];

  (await Promise.all([...linksList.values()].map(async ({
    fullLink,
    channelName,
    postId,
    notes,
    rawNotes,
    fetchPhotos,
    photosPositions,
  }) => {
    if (channelName === "c") {
        log(`Ошибка при сборе поста: ${fullLink}`);
        return {failed: {
            fullLink,
            notes: rawNotes,
          }};
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
  
      // Получаем пост из телеграмма
      const cacheKey = `${channelName}_${postId}_${photosPositions}`
      const cachedPost = await util.promisify(postsCache.get)(cacheKey);
      if(cachedPost) {
        return {succeed: cachedPost};
      }
      const rawPost = await getPosts(channelName, postIds, fullLink);
  
      if (!rawPost) {
        log(`Ошибка при сборе поста: ${fullLink}`);
        return {failed: {
            fullLink,
            notes: rawNotes,
          }};
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
        log(`Успешно собран пост: ${fullLink}`);
        await util.promisify(postsCache.put)(cacheKey, formattedPost);
        return {succeed: formattedPost};
      } else {
        log(`Ошибка при сборе поста: ${fullLink}`);
        return {failed: formattedPost};
      }
  }))).forEach(({failed, succeed}) => {
    if(failed)
        failedPosts.push(failed);
    if(succeed)
        posts.push(succeed);
  })

  log('Сбор постов завершен');
  return { posts, failedPosts };
}

exports.fetchPosts = fetchPosts;

function assembleCsv(posts) {
  log('Начал собирать таблицу');

  const delimiter = '\t';
  let header = `Автор${delimiter}Repost${delimiter}Дата${delimiter}Сообщение${delimiter}Ссылка`;
  let maximumNotesPerRow = 0;
  const rows = [];

  for (const { title, forwardedFrom, date, message, fullLink, notes } of posts) {
    let row = [];

    row.push(title ?? '');
    row.push(forwardedFrom ?? '');
    row.push(date ?? '');
    row.push(message?.replace(/\n/gm, ' NEWLINE ') ?? '');
    row.push(fullLink);

    if (notes) {
      row.push(...notes);
      maximumNotesPerRow = notes.length > maximumNotesPerRow ? notes.length : maximumNotesPerRow;
    }

    rows.push(row.join(delimiter));
  }

  for (let i = 1; i <= maximumNotesPerRow; i++) {
    if (i === 1)
      header += `${delimiter}Категория`;
    else if(i === 2)
      header +=  `${delimiter}Подкатегория`;
    else
      header += `${delimiter}Note${i}`;
  }
  header += '\n';

  log('Закончил собирать таблицу');
  return header + rows.join('\n');
}

exports.assembleCsv = assembleCsv;

const { getPosts, getPhoto } = require('./telegram');
const { settings, config } = require('./settings');

const host = 'localhost';
const port = 8083;
const server = createServer(requestListener);
server.listen(port, host, () => {});

exec(`start http://${host}:${port}/`);

process.on('uncaughtException', UncaughtExceptionHandler);

function UncaughtExceptionHandler(err) {
  console.log('Uncaught Exception Encountered!!');
  console.log('err: ', err);
  console.log('Stack trace: ', err.stack);
}
