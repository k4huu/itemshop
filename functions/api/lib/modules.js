
const { getTokenFromGCPServiceAccount } = require('@sagi.io/workers-jwt')
const md5 = require('md5')
let fetch

// REQUEST

function getBaseUrl (url) {
  const l = url.split('/')
  return `${l[0]}//${l[2]}`
  // return 'https://1099-79-184-136-197.ngrok.io'
}

exports.request = (handler) => {
  return {
    async cloudflare ({request, env}) {
      fetch = globalThis.fetch
      const params = {}
      const queryString = new URL(request.url).search.slice(1).split('&')
      queryString.forEach(item => {
        const kv = item.split('=')
        if (kv[0]) params[kv[0]] = kv[1] || true
      })
      const url = request.url
      let body = false
      try {
        body = await request.json()
      } catch (e) {}
      return handler({
        params,
        url,
        baseUrl: getBaseUrl(url),
        apiBaseUrl: `${getBaseUrl(url)}/api`,
        firebase: await new Firebase(env.FIREBASE_CONFIG).init_cloudflare(),
        fetch,
        ip: request.headers.get('cf-connecting-ip'),
        body
      }).then((data) => (
        new Response(JSON.stringify({success: true, data}), {headers: {'content-type': 'application/json'}})
      )).catch((error) => (
        new Response(JSON.stringify({success: false, error}), {headers: {'content-type': 'application/json'}})
      ))
    },
    async netlify (event, context) {
      const a = 'node-fetch'
      fetch = require(a)
      const url = event.rawUrl
      return handler({
        params: event.queryStringParameters,
        url,
        baseUrl: getBaseUrl(url),
        apiBaseUrl: `${getBaseUrl(url)}/.netlify/functions`,
        firebase: await new Firebase(process.env.FIREBASE_CONFIG).init(),
        fetch,
        ip: event.headers['x-nf-client-connection-ip'],
        body: event.body ? JSON.parse(event.body) : false
      }).then((data) => ({
        statusCode: 200,
        body: JSON.stringify({success: true, data})
      })).catch((error) => ({
        statusCode: 200,
        body: JSON.stringify({success: false, error})
      }))
    },
    vercel () {
      try {
        const a = 'node-fetch'
        fetch = require(a)
        const b = 'express'
        const express = require(b)
        const app = express()
        app.use(express.json())
        app.use(express.urlencoded({extended: true}))
        app.all(`/api/:name`, async (req, res) => {
          const body = JSON.parse(Object.keys(req.body)[0])
          const url = req.protocol + '://' + req.get('host') + req.originalUrl
          handler({
            params: req.query,
            url,
            baseUrl: getBaseUrl(url),
            apiBaseUrl: `${getBaseUrl(url)}/api`,
            firebase: await new Firebase(process.env.FIREBASE_CONFIG).init(),
            fetch,
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            body
          }).then((data) => {
            res.json({success: true, data})
          }).catch((error) => {
            res.json({success: false, error})
          })
        })
        return app
      } catch (e) {}
    }
  }
}

// FIREBASE

class Firebase {
  constructor (firebaseConfig) {
    const {publicConfig, serviceAccount} = JSON.parse(firebaseConfig)
    this.publicConfig = publicConfig
    this.serviceAccount = serviceAccount
  }
  async init () {
    this.access_token = await new Promise((resolve, reject) => {
      const a = 'googleapis'
      const {google} = require(a)
      var jwtClient = new google.auth.JWT(
        this.serviceAccount.client_email,
        null,
        this.serviceAccount.private_key,
        [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/firebase.database'
        ]
      )
      jwtClient.authorize(function (error, tokens) {
        if (error) {
          reject(`Error making request to generate access token: ${error}`)
        } else if (tokens.access_token === null) {
          reject('Provided service account does not have permission to generate access tokens')
        } else {
          resolve(tokens.access_token)
        }
      })
    })
    return this
  }
  async init_cloudflare () {
    const jwtToken = await getTokenFromGCPServiceAccount({
      serviceAccountJSON: this.serviceAccount,
      aud: 'https://oauth2.googleapis.com/token',
      payloadAdditions: {
        scope: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/firebase.database'
        ].join(' ')
      }
    })
    const {access_token} = await (
      await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwtToken
        })
      })
    ).json()
    this.access_token = access_token
    return this
  }
  async get (path) {
    const response = await fetch(`${this.publicConfig.databaseURL}/${path}.json`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.access_token}`
      }
    })
    const data = await response.json()
    if (data) {
      return data
    } else {
      throw 'reference_not_found'
    }
  }
  async remove (path) {
    await fetch(`${this.publicConfig.databaseURL}/${path}.json`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.access_token}`
      }
    })
  }
  async update (path, val) {
    await fetch(`${this.publicConfig.databaseURL}/${path}.json`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.access_token}`
      },
      body: JSON.stringify(val)
    })
  }
  async push (path, val) {
    await fetch(`${this.publicConfig.databaseURL}/${path}.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.access_token}`
      },
      body: JSON.stringify(val)
    })
  }
}

// VALIDATORS

exports.validate = {
  nick (text) {
    return new Promise((resolve, reject) => {
      if (!/^[a-zA-Z0-9_]{2,16}$/.test(text) || typeof (text) !== 'string') {
        reject('wrong_format_nick')
      } else {
        resolve(text)
      }
    })
  },
  shopid (text) {
    return new Promise((resolve, reject) => {
      if (!/^[A-Za-z0-9_]{4,}$/.test(text) || typeof (text) !== 'string') {
        reject('wrong_format_shopid')
      } else {
        resolve(text)
      }
    })
  },
  serviceid (text) {
    return new Promise((resolve, reject) => {
      if (!/^[A-Za-z0-9_]{3,}$/.test(text) || typeof (text) !== 'string') {
        reject('wrong_format_serviceid')
      } else {
        resolve(text)
      }
    })
  },
  smscode (text) {
    return new Promise((resolve, reject) => {
      if (!/^[A-Za-z0-9]{8}$/.test(text) || typeof (text) !== 'string') {
        reject('wrong_format_code')
      } else {
        resolve(text)
      }
    })
  },
  vouchercode (text) {
    return new Promise((resolve, reject) => {
      if (!/^[a-z0-9]{6,}$/.test(text) || typeof (text) !== 'string') {
        reject('wrong_format_vouchercode')
      } else {
        resolve(text)
      }
    })
  },
  amount (text) {
    return new Promise((resolve, reject) => {
      if (!/^[1-9][0-9]*$/.test(text) || typeof (text) !== 'string') {
        reject('wrong_format_amount')
      } else {
        resolve(parseFloat(text))
      }
    })
  },
  paymenttype (text) {
    return new Promise((resolve, reject) => {
      if (text === 'lvlup' || text === 'microsms_transfer') {
        resolve(text)
      } else {
        reject('wrong_format_paymenttype')
      }
    })
  },
  serverid (text) {
    return new Promise((resolve, reject) => {
      if (!/^[A-Za-z0-9_]{4,}$/.test(text) || typeof (text) !== 'string') {
        reject('wrong_format_amount')
      } else {
        resolve(parseFloat(text))
      }
    })
  }
}

// GENERATORS

exports.generateLvlup = async({config, nick, shopid, serviceid, service, amount, apiBaseUrl, baseUrl}) => {
  let cost = String(parseFloat(service.lvlup_cost) * amount)
  cost = (+(Math.round(cost + 'e+2') + 'e-2')).toFixed(2)
  const sandbox = true
  const response = await fetch(`https://api${sandbox ? '.sandbox' : ''}.lvlup.pro/v4/wallet/up`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.lvlup_api}`
    },
    body: JSON.stringify({
      amount: cost,
      redirectUrl: baseUrl,
      webhookUrl: `${apiBaseUrl}/payment_webhook?paymenttype=lvlup&nick=${nick}&shopid=${shopid}&serviceid=${serviceid}&amount=${amount}`
    })
  })
  return (await response.json()).url
}

exports.generateMicrosmsTransfer = ({config, nick, shopid, serviceid, service, amount, apiBaseUrl, baseUrl}) => {
  const cost = service.microsms_transfer_cost * amount
  const params = new URLSearchParams({
    shopid: config.microsms_transfer_id,
    amount: cost,
    signature: md5(`${config.microsms_transfer_id}${config.microsms_transfer_hash}${cost}`),
    description: `${service.name} dla ${nick}`,
    control: `${shopid}|${serviceid}|${nick}`,
    returl_url: `${baseUrl}`,
    returl_urlc: `${apiBaseUrl}/payment_webhook?paymenttype=microsms_sms&shopid=${shopid}&serviceid=${serviceid}&amount=${amount}`
  })
  return `https://microsms.pl/api/bankTransfer/?${params}`
}

// CHECKERS

const getDate = () => {
  let d = new Date()
  let ye = new Intl.DateTimeFormat('en', { year: 'numeric' }).format(d)
  let mo = new Intl.DateTimeFormat('en', { month: '2-digit' }).format(d)
  let da = new Intl.DateTimeFormat('en', { day: '2-digit' }).format(d)
  return `${ye}-${mo}-${da}`
}

exports.checkIfVoucherExpired = async (voucher) => {
  if (!(((voucher.end && voucher.start <= getDate()) || (!voucher.end && voucher.start === getDate())) && ((voucher.end && voucher.end >= getDate()) || !voucher.end))) {
    throw 'voucher_expired'
  }
}

exports.checkMicrosmsCode = async ({service, config, smscode}) => {
  const number = ({
    1: '71480',
    2: '72480',
    3: '73480',
    4: '74480',
    5: '75480',
    6: '76480',
    7: '79480',
    8: '91400',
    9: '91900',
    10: '92022',
    11: '92550'
  })[service.microsms_sms_type]
  const response = await fetch(`https://microsms.pl/api/check.php?userid=${config.microsms_user_id}&number=${number}&code=${smscode}&serviceid=${config.microsms_sms_id}`)
  const data = await response.text()
  if (data.split(',')[0] !== '1') {
    throw 'wrong_code'
  }
}

exports.checkMicrosmsIp = async ({ip}) => {
  const response = await fetch('https://microsms.pl/psc/ips/')
  const data = await response.text()
  if (!data.split(',').includes(ip)) {
    throw 'wrong_ip_address'
  }
}

// EXECUTE SERVICE

exports.executeService = async ({type, firebase, service, serviceid, shopid, nick, validate, amount}) => {
  // send commands to server
  const serverid = validate.serverid(service.server)
  const server = await firebase.get(`servers/${serverid}`)
  const shop = await firebase.get(`shops/${shopid}`)
  if (shop.owner === server.owner) {
    const commands = service.commands.split('\n')
    const newCommands = {}
    for (let command of commands) {
      command = command.replace(/\[nick\]/g, nick)
      command = command.replace(/\[n\]/g, amount)
      await firebase.push(`servers/${serverid}/commands`, command)
    }
  }

  // send discord webhook
  try {
    const webhookUrl = await firebase.get(`config/${shopid}/webhook`)
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: null,
        embeds: [{
          color: shop.theme ? parseInt(shop.theme.replace(/^#/, ''), 16) : 255,
          title: 'Nowy zakup w sklepie',
          url: 'https://itemszop.tk/',
          author: {
            name: shop.name,
            icon_url: shop.icon ? shop.icon : 'https://itemszop.tk/item.png',
            url: 'https://itemszop.tk/'
          },
          description: `${nick} właśnie kupił(a) ${service.name}`,
          thumbnail: {
            url: service.icon ? service.iconUrl : 'https://itemszop.tk/item.png'
          },
          timestamp: new Date()
        }]
      })
    })
  } catch (e) {}

  // save to payments history
  await firebase.push(`shops/${shopid}/history`, {
    nick,
    service: service.name,
    serviceid,
    date: Date.now(),
    type
  })
}
