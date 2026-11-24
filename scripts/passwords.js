const crypto = require('crypto');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
module.exports.generatePassword = (len = 12) =>
  Array.from({ length: len }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
