// Local development only. On Vercel, public/ is served as static files and
// lib/app.js runs as the api/index.js function.
const path = require('path');
const express = require('express');
const app = require('./lib/app');
const { headers } = require('./vercel.json');

const server = express();
server.disable('x-powered-by');
server.use((req, res, next) => {
  headers[0].headers.forEach(({ key, value }) => { if (key !== 'Strict-Transport-Security') res.setHeader(key, value); });
  next();
});
server.use(express.static(path.join(__dirname, 'public')));
server.use(app);
const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => console.log(`Hackathon app running on http://localhost:${PORT}`));
