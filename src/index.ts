import { Telegraf, session, Context } from 'telegraf';
import { about } from './commands/about';
import { admin } from './commands/admin';
import { user } from './commands/user';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { development, production } from './core';
import { initializeFirebase } from './utils/firebase';

// Define custom context with session
interface MyContext extends Context {
  session: {
    state?: string;
    messageId?: number;
  };
}

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

const bot = new Telegraf<MyContext>(BOT_TOKEN);

// Initialize session middleware
bot.use(session());

// Initialize Firebase
initializeFirebase();

// Commands
bot.command('about', about());
bot.command('admin', admin(bot));
bot.start(user(bot));

// Launch bot based on environment
if (ENVIRONMENT === 'production' && WEBHOOK_URL) {
  // Set webhook for production
  bot.telegram.setWebhook(`${WEBHOOK_URL}/api`).then(() => {
    console.log(`Webhook set to ${WEBHOOK_URL}/api`);
  }).catch(err => {
    console.error('Failed to set webhook:', err);
  });
} else {
  // Delete webhook and use polling for development
  bot.telegram.deleteWebhook().then(() => {
    console.log('Webhook deleted, starting polling...');
    bot.launch();
  }).catch(err => {
    console.error('Failed to delete webhook:', err);
  });
}

// Vercel production mode
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  try {
    // Ensure only one response is sent
    if (res.headersSent) {
      console.warn('Headers already sent, skipping response');
      return;
    }
    await production(req, res, bot as unknown as Telegraf<Context>);
  } catch (error) {
    console.error('Error in startVercel:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
};
