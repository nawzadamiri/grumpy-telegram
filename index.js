const express = require('express')
const bodyParser = require('body-parser')
const fetch = require('node-fetch')
const fileSystem = require('fs')
const path = require('path')
const TelegramBot = require('node-telegram-bot-api')
const cors = require('cors')
const Web3 = require('web3')
const app = express()
const port = process.env.PORT || 3000

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())
app.use(cors())

const telegramToken = process.env.TELEGRAM_BOT_TOKEN
const ethplorerApiKey = process.env.ETHPLORER_API_KEY
const infuraId = process.env.INFURA_ID
const etherScanApiKey = process.env.ETHERSCAN_API_KEY
const grumpyTokenContract = '0x93b2fff814fcaeffb01406e80b4ecd89ca6a021b'

let web3 = new Web3(new Web3.providers.HttpProvider(`https://mainnet.infura.io/${infuraId}`))

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
  const isLessThanFiveMinuteOld = minutesSinceTimestamp(message.date) <= 5

  console.log(`
    This message...
    - Exists: ${message ? JSON.stringify(message) : false},
    - Is From A Bot: ${isFromBot},
    - Has Text: ${hasText},
    - Starts With /Price: ${startsWithPrice},
    - Is New: ${isNew},
    - Is Bot Command: ${isBotCommand},
    - Is This Old (mins): ${minutesSinceTimestamp(message.date)}
  `)

  return exists && !isFromBot && hasText && startsWithPrice && isBotCommand && isNew && isLessThanFiveMinuteOld
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

let tokenInfo
let lastRequested
app.get('/token-info', async (req, res) => {
  const today = new Date
  const now = today.getTime()
  const fiveMinutes = 1000 * 60 * 5

  // send tokenInfo stored in memory if the last request was less than 5 minutes ago
  if (tokenInfo !== undefined && lastRequested !== undefined && now - lastRequested <= fiveMinutes) {
    return res.send(tokenInfo)
  }
  // get fresh tokenInfo
  try {
    let tokenInfoRequest = await fetch(`https://api.ethplorer.io/getTokenInfo/${grumpyTokenContract}?apiKey=${ethplorerApiKey}`)
    tokenInfo = await tokenInfoRequest.json()
    lastRequested = new Date().getTime()
    console.log('sending new token info', lastRequested)
    return res.send(tokenInfo)
  } catch (err) {
    console.log('error', err)
    return res.send(500)
  }
})

let charityInfo
let lastRequestedCharity
app.get('/charity-progress', async (req, res) => {
  const today = new Date
  const now = today.getTime()
  const fiveMinutes = 1000 * 60 * 5

  // send charityInfo stored in memory if the last request was less than 5 minutes ago
  if (charityInfo !== undefined && lastRequestedCharity !== undefined && now - lastRequestedCharity <= fiveMinutes) {
    return res.send(charityInfo)
  }

  const grumpyContractId = '0x93B2FfF814FCaEFFB01406e80B4Ecd89Ca6A021b'
  const grumpyEthCharityWallet = '0x405715ab97d667be039396adbc99b440d327febb'
  const dogeWalletId = 'D7FhT7L1hCeBYUou7kLyaHs75zKGUrv2c9'
  const ltcWalletId = 'ltc1qcyl0n27pmgyxyvgc0c8djewtdhqecg2gej36ga'
  function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // load eth wallet
  let ethWallet
  try {
    let request = await fetch(`https://api.ethplorer.io/getAddressInfo/${grumpyEthCharityWallet}?apiKey=${ethplorerApiKey}`)
    let json = await request.json()
    ethWallet = json
  } catch (err) {
    console.log('error getting eth wallet', err)
    return res.send(500)
  }

  // find the grumpy token in the eth wallet
  const grumpyTokenData = ethWallet.tokens.find(t => {
    return t.tokenInfo.address.toLowerCase() == grumpyContractId.toLowerCase()
  })
  // set Eth USD value
  const ethBalance = ethWallet.ETH.balance
  const ethUsdValue = ethBalance * ethWallet.ETH.price.rate
  // set Grumpy balance
  // the grumpy balance from ethplorer is on a very big delay (days) so we need to make a separate call to etherscan to get the correct balance
  let grumpyBalanceInfo
  try {
    let request = await fetch(`https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${grumpyContractId}&address=${grumpyEthCharityWallet}&tag=latest&apikey=${etherScanApiKey}`)
    let json = await request.json()
    grumpyBalanceInfo = json
  } catch (err) {
    console.log('error getting grumpy balance', err)
    return res.send(500)
  }
  const grumpyBalance = web3.utils.fromWei(grumpyBalanceInfo.result, 'gwei')
  // set Grumpy USD value
  const grumpyToUsdRate = Number.parseFloat(grumpyTokenData.tokenInfo.price.rate).toFixed(parseInt(grumpyTokenData.tokenInfo.decimals))
  const grumpyUsdValue = grumpyToUsdRate * grumpyBalance
  // set Grumpy balance without 1T tokens
  const grumpyBalanceWithout1T = (grumpyBalance - 1000000000000).toLocaleString('fullwide', {useGrouping:false})
  const grumpyUsdValueWithout1T = grumpyToUsdRate * grumpyBalanceWithout1T
  // use grumpy timestamp as the last updated because ethplorer takes the longest to update their data
  const dataLastUpdated = grumpyTokenData.tokenInfo.lastUpdated

  // load doge wallet data
  let dogeWallet
  try {
    let request = await fetch(`https://chain.so/api/v2/get_address_balance/DOGE/${dogeWalletId}`)
    let json = await request.json()
    dogeWallet = json
  } catch (err) {
    console.log('error getting doge wallet', err)
    return res.send(500)
  }

  let dogePrice
  try {
    let request = await fetch('https://chain.so/api/v2/get_price/DOGE')
    let json = await request.json()
    dogePrice = json
  } catch (err) {
    console.log('error getting doge price', err)
    return res.send(500)
  }

  // set doge balance
  const dogeBalance = dogeWallet.data.confirmed_balance
  // set doge to usd
  const dogeUsdRate = dogePrice.data.prices.find(p => p.price_base === 'USD').price
  const dogeUsdValue = parseFloat(dogeUsdRate) * parseFloat(dogeBalance)

  // load litecoin wallet data
  let ltcWallet
  try {
    let request = await fetch(`https://chain.so/api/v2/get_address_balance/LTC/${ltcWalletId}`)
    let json = await request.json()
    ltcWallet = json
  } catch (err) {
    console.log('error getting ltc wallet', err)
    return res.send(500)
  }

  let ltcPrice
  try {
    let request = await fetch('https://chain.so/api/v2/get_price/LTC')
    let json = await request.json()
    ltcPrice = json
  } catch (err) {
    console.log('error getting ltc price')
    return res.send(500)
  }

  // set litecoin balance
  const ltcBalance = ltcWallet.data.confirmed_balance
  // set ltc to usd
  const ltcUsdRate = ltcPrice.data.prices.find(p => p.price_base === 'USD').price
  const ltcUsdValue = parseFloat(ltcUsdRate) * parseFloat(ltcBalance)

  // set totals
  const totalUsdValue = ethUsdValue + grumpyUsdValue + dogeUsdValue + ltcUsdValue
  const totalUsdValueWithout1TGrumpy =  ethUsdValue + grumpyUsdValueWithout1T + dogeUsdValue + ltcUsdValue
  // set charity info and send it
  charityInfo = {
    ethBalance: ethBalance,
    ethUsdValue:  Number.parseFloat(ethUsdValue.toFixed(2)),
    ethUsdValueFormatted: '$' + numberWithCommas(ethUsdValue.toFixed(2)),
    grumpyBalance: grumpyBalance,
    grumpyUsdValue:  Number.parseFloat(grumpyUsdValue.toFixed(2)),
    grumpyUsdValueFormatted: '$' + numberWithCommas(grumpyUsdValue.toFixed(2)),
    grumpyBalanceWithout1T: grumpyBalanceWithout1T,
    grumpyUsdValueWithout1T:  Number.parseFloat(grumpyUsdValueWithout1T.toFixed(2)),
    grumpyUsdValueWithout1TFormatted: '$' + numberWithCommas(grumpyUsdValueWithout1T.toFixed(2)),
    dogeBalance: dogeBalance,
    dogeUsdValue:  Number.parseFloat(dogeUsdValue.toFixed(2)),
    dogeUsdValueFormatted: '$' + numberWithCommas(dogeUsdValue.toFixed(2)),
    ltcBalance: ltcBalance,
    ltcUsdValue: ltcUsdValue.toFixed(2),
    ltcUsdValueFormatted: '$' + numberWithCommas(ltcUsdValue.toFixed(2)),
    totalUsdValue: Number.parseFloat(totalUsdValue.toFixed(2)),
    totalUsdValueFormatted: '$' + numberWithCommas(totalUsdValue.toFixed(2)),
    totalUsdValueWithout1TGrumpy:  Number.parseFloat(totalUsdValueWithout1TGrumpy.toFixed(2)),
    totalUsdValueWithout1TGrumpyFormatted: '$' + numberWithCommas(totalUsdValueWithout1TGrumpy.toFixed(2)),
    lastUpdated: dataLastUpdated
  }
  return res.send(charityInfo)
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})
