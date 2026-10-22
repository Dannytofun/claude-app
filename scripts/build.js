'use strict';
// Builds the app from src/app.html:
//   public/index.html     - served by the backend
//   aliran-cashflow.html  - standalone file you can open directly (local-only mode)
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const body = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8').replace(/\r\n?/g, '\n');
const page = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
  + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  + body + '\n</html>\n';

fs.mkdirSync(path.join(root, 'public'), { recursive: true });
for (const out of ['public/index.html', 'aliran-cashflow.html']) {
  fs.writeFileSync(path.join(root, out), page);
  console.log('built', out);
}
