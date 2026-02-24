'use strict';

const https = require('https');

// Guardamos likes en memoria:
// { "GOOG": { likes: 2, ips: Set(["1.2.3.4", ...]) } }
const likesStore = {};

function getClientIp(req) {
  // Render / proxies: x-forwarded-for puede traer lista "ip, ip, ip"
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function fetchStockPrice(symbol) {
  const stock = String(symbol || '').trim().toUpperCase();
  const url = `https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${stock}/quote`;

  return new Promise((resolve, reject) => {
    https
      .get(url, (resp) => {
        let data = '';
        resp.on('data', (chunk) => (data += chunk));
        resp.on('end', () => {
          try {
            const json = JSON.parse(data);

            // Cuando es inválida, normalmente viene { "stockData": null } o similar
            if (!json || !json.symbol || typeof json.latestPrice !== 'number') {
              return resolve({ stock, price: null });
            }

            resolve({ stock: json.symbol.toUpperCase(), price: json.latestPrice });
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function ensureStore(stock) {
  if (!likesStore[stock]) {
    likesStore[stock] = { likes: 0, ips: new Set() };
  }
  return likesStore[stock];
}

function applyLike(stock, ip, like) {
  const entry = ensureStore(stock);
  if (like && !entry.ips.has(ip)) {
    entry.ips.add(ip);
    entry.likes += 1;
  }
  return entry.likes;
}

module.exports = function (app) {
  app.route('/api/stock-prices').get(async function (req, res) {
    try {
      let { stock, like } = req.query;

      // stock puede ser string o array (si vienen 2 stocks)
      const stocks = Array.isArray(stock) ? stock : [stock];
      const likeBool = like === 'true' || like === true;
      const ip = getClientIp(req);

      // Obtener data de 1 o 2 stocks
      const results = await Promise.all(stocks.map(fetchStockPrice));

      if (results.length === 1) {
        const s = results[0];
        const likes = applyLike(s.stock, ip, likeBool);

        return res.json({
          stockData: {
            stock: s.stock,
            price: s.price,
            likes: likes
          }
        });
      }

      // Dos stocks -> rel_likes
      const s1 = results[0];
      const s2 = results[1];

      const likes1 = applyLike(s1.stock, ip, likeBool);
      const likes2 = applyLike(s2.stock, ip, likeBool);

      return res.json({
        stockData: [
          { stock: s1.stock, price: s1.price, rel_likes: likes1 - likes2 },
          { stock: s2.stock, price: s2.price, rel_likes: likes2 - likes1 }
        ]
      });
    } catch (err) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });
};
