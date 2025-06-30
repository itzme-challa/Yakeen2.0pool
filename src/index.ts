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

const bot = new Telegraf<MyContext>(BOT_TOKEN);

// Initialize session middleware
bot.use(session());

// Initialize Firebase
initializeFirebase();

// Commands
bot.command('about', about());
bot.command('admin', admin(bot));
bot.start(user(bot));

bot.launch();

// Vercel production mode
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot as unknown as Telegraf<Context>);
};

// Development mode
if (ENVIRONMENT !== 'production') {
  development(bot as unknown as Telegraf<Context>);
}
