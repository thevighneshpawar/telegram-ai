import dotenv from 'dotenv'
dotenv.config()

import TelegramBot from 'node-telegram-bot-api'
import { GoogleGenerativeAI } from '@google/generative-ai'
import fs from 'fs'

const USERS_FILE = './users.json'

// Load ENV variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL

if (!TELEGRAM_TOKEN || !GEMINI_API_KEY || !REQUIRED_CHANNEL) {
  throw new Error(
    'Missing TELEGRAM_TOKEN, GEMINI_API_KEY or REQUIRED_CHANNEL in .env'
  )
}

// Initialize bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true })

// Initialize Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)

// Track active users to prevent spam
const activeUsers = new Set()

// Save unique chat IDs
function saveUser (chatId) {
  let users = []
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE))
  }

  if (!users.includes(chatId)) {
    users.push(chatId)
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2))
  }
}

// Format output text from Gemini
function formatText (text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '*$1*') // Convert bold markdown
    .replace(/\n{2,}/g, '\n\n') // Normalize spacing
    .replace(/^\* /gm, '• ') // Bullet points
}

// Escape Telegram MarkdownV2 reserved characters
function escapeMarkdownV2 (text) {
  return text.replace(/([_\*\[\]\(\)~`>#+=|{}.!\\\-])/g, '\\$1') // Escape all special chars
}

// Check if user is a member of the required channel
async function isUserInChannel (userId) {
  try {
    const res = await bot.getChatMember(REQUIRED_CHANNEL, userId)
    return ['creator', 'administrator', 'member'].includes(res.status)
  } catch (error) {
    console.error('Channel check failed:', error)
    return false
  }
}

// Get response from Gemini
async function getGeminiResponse (userMessage) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    const result = await model.generateContent(userMessage)
    const response = await result.response
    return response.text()
  } catch (error) {
    console.error('Gemini API Error:', error)
    return "Sorry, I couldn't process that. Please try again later."
  }
}

// Handle /start
bot.onText(/\/start/, async msg => {
  const chatId = msg.chat.id
  const userId = msg.from.id

  const isMember = await isUserInChannel(userId)
  if (!isMember) {
    return bot.sendMessage(
      chatId,
      `🔒 Please join our channel to use this bot: ${REQUIRED_CHANNEL}`
    )
  }

  saveUser(chatId) // ✅ Save user ID

  const welcomeMessage = `
🤖 *Welcome to the Gemini AI Bot!*

Send me any message and I’ll respond using *Google's Gemini AI*.

*Note:* Only text messages are supported.
  `
  await bot.sendMessage(chatId, escapeMarkdownV2(welcomeMessage), {
    parse_mode: 'MarkdownV2'
  })
})

// Handle general text messages
bot.on('text', async msg => {
  const chatId = msg.chat.id
  const userId = msg.from.id
  const userMessage = msg.text

  if (userMessage.startsWith('/')) return

  const isMember = await isUserInChannel(userId)
  if (!isMember) {
    return bot.sendMessage(
      chatId,
      `🔒 Please join our channel to use this bot: ${REQUIRED_CHANNEL}`
    )
  }

  if (activeUsers.has(chatId)) {
    return bot.sendMessage(chatId, '⏳ Please wait for the current response.')
  }

  saveUser(chatId) // ✅ Save user ID if not already

  try {
    activeUsers.add(chatId)
    await bot.sendChatAction(chatId, 'typing')

    const rawResponse = await getGeminiResponse(userMessage)
    const formatted = escapeMarkdownV2(formatText(rawResponse))

    await bot.sendMessage(chatId, formatted, {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true
    })
  } catch (error) {
    console.error('Error responding to user:', error)
    await bot.sendMessage(
      chatId,
      '⚠️ Something went wrong. Please try again later.'
    )
  } finally {
    activeUsers.delete(chatId)
  }
})

// Handle non-text messages
bot.on('message', msg => {
  if (!msg.text) {
    bot.sendMessage(msg.chat.id, '📄 I can only understand text messages.')
  }
})

// Handle unknown commands
bot.onText(/\/(.+)/, (msg, match) => {
  const chatId = msg.chat.id
  const command = match[1].toLowerCase()

  // Skip known/valid commands
  const knownCommands = ['start'] // Add more later if needed
  if (knownCommands.includes(command)) return

  bot.sendMessage(chatId, `❌ Unknown command: /${command}`)
})

// Log errors
bot.on('error', error => {
  console.error('Bot Error:', error)
})

console.log('🤖 Telegram bot is running. Send /start to begin chatting.')
