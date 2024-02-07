const { } = require('./bot');
const { createServer } = require('http');
const { writeFile, mkdirSync, existsSync, readFile } = require('fs');
const { log } = require('console');
const { exec } = require('child_process');
const process = require('process');


const { fetchPosts, assembleCsv } = require('./posts')

const contentTypes = {
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
  js: 'text/javascript',
  json: 'application/json',
  html: 'text/html',
  css: 'text/css',
};

async function requestListener(req, res) {
  const [route, folderName, fileName] = req.url.slice(1).split('/');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  let body = [];

  req
    .on('data', (chunk) => {
      body.push(chunk);
    })
    .on('end', async () => {
      body = Buffer.concat(body).toString();

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
        readFile('settings.json', (err, data) => {
          if (!err) {
            let settings = JSON.parse(data);

            if (req.headers['content-type'] === contentTypes.json) {
              const parsedBody = JSON.parse(body);
              settings = { ...settings, ...parsedBody };
              writeFile('settings.json', JSON.stringify(settings, null, 2), () => {});
            }

            res.setHeader('Content-Type', contentTypes.json);
            res.writeHead(200);
            res.end(JSON.stringify(settings));
          } else {
            res.writeHead(200);
            res.end();
          }
        });
        return;
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
