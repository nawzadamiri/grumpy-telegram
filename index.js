const express = require('express')
const bodyParser = require('body-parser')
const fetch = require('node-fetch')
const fileSystem = require('fs')
const path = require('path')
const TelegramBot = require('node-telegram-bot-api')
const { start } = require('repl')
const app = express()
const port = process.env.PORT || 3000

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

const telegramToken = process.env.TELEGRAM_BOT_TOKEN
const ethplorerApiKey = process.env.ETHPLORER_API_KEY

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(telegramToken, {polling: false})

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.get('/public-key', (req, res) => {
  const filePath = path.join(__dirname, 'crt.pem');
  const stat = fileSystem.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': 'application/x-x509-ca-cert',
    'Content-Length': stat.size
  });
  const readStream = fileSystem.createReadStream(filePath);
  readStream.pipe(res);
})

const production  = 'https://grumpy-telegram.herokuapp.com';
const development = process.env.TUNNEL_URL;
const url = (process.env.NODE_ENV ? production : development);
bot.setWebHook(url, {
  certificate: '/crt.pem', // Path to your crt.pem
});

const getGrumpyPrice = (priceInfo) => {
  const numDecimals = 9
  return Number.parseFloat(priceInfo.rate).toFixed(numDecimals)
}


const numberWithCommas = (number) => {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// could be useful in the future so I am leaving this here for now
// const getDateFromTimestamp = (timestamp) => {
//   const milliseconds = timestamp * 1000
//   const date = new Date(milliseconds)
//   return date.toLocaleString("en-US", {timeZoneName: "short"})
// }

const minutesSinceTimestamp = (timestamp) => {
  const tsMilliseconds = timestamp * 1000

  const now = Date.now()
  const millisecondsBetweenTsAndNow = now - tsMilliseconds
  const minutesBetweenTsAndNow =  millisecondsBetweenTsAndNow / 1000
  return minutesBetweenTsAndNow
}

let recentlySeenMessageIds = []

const haveNotSeenMessageBefore = (message) => {
  if (recentlySeenMessageIds.includes(message.message_id)) return false
  recentlySeenMessageIds.push(message.message_id)
  return true
}

const willRespondToMessage = (payload) => {
  const exists = Object.prototype.hasOwnProperty.call(payload, 'message')
  if (!exists) return false
  const message = payload.message
  const isFromBot = message.from.is_bot 
  const hasText = message.text
  const startsWithPrice = hasText && message.text.startsWith('/price')
  const isNew = haveNotSeenMessageBefore(message)
  const isBotCommand = message.entities && message.entities.find(e => e.type === 'bot_command') !== undefined
  const isLessThanOneMinuteOld = minutesSinceTimestamp(message.date) <= 5

  console.log(`
    This message...
    - Exists: ${message ? JSON.stringify(message) : false},
    - Is From A Bot: ${isFromBot},
    - Has Text: ${hasText},
    - Starts With /Price: ${startsWithPrice},
    - Is New: ${isNew},
    - Is Bot Command: ${isBotCommand},
    - Is This Old: ${minutesSinceTimestamp(message.date)}
  `)

  return exists && !isFromBot && hasText && startsWithPrice && isBotCommand && isNew && isLessThanOneMinuteOld
}


app.post('/', async (req, res) => {
  const payload = req.body
  console.log(JSON.stringify(payload))
  const respondToMessage = willRespondToMessage(payload)
  console.log('will respond to msg: ' + respondToMessage)
  if (!respondToMessage) return res.send(200)

  const msg = payload.message
  const chatId = msg.chat.id
  
  const grumpyTokenContract = '0x93b2fff814fcaeffb01406e80b4ecd89ca6a021b'
  let resp, tokenInfo, botMsgSent
  
  try {
    let tokenInfoRequest = await fetch(`https://api.ethplorer.io/getTokenInfo/${grumpyTokenContract}?apiKey=${ethplorerApiKey}`)
    tokenInfo = await tokenInfoRequest.json()
  } catch (err) {
    console.log('error', err)
    botMsgSent = await bot.sendMessage(chatId, "🙅 There were problems fetching the latest $GRUMPY token info. Figures...")
    return res.send(500)
  }
  
  resp = '💵 Price: ' + getGrumpyPrice(tokenInfo.price) + '\n' +
         '💎 Holders: ' + numberWithCommas(tokenInfo.holdersCount) + '\n'
  try {
    botMsgSent = await bot.sendMessage(chatId, resp);
    return res.send(200)
  } catch (err) {
    console.log('error', err)
    return res.send(500)
  }
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})