import { Telegraf } from 'telegraf';
import { about } from './commands/about';
import { admin } from './commands/admin';
import { user } from './commands/user';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { development, production } from './core';
import { initializeFirebase } from './utils/firebase';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';

const bot = new Telegraf(BOT_TOKEN);

// Initialize Firebase
initializeFirebase();

// Commands
bot.command('about', about());
bot.command('admin', admin());
bot.start(user());

bot.launch();

// Vercel production mode
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

// Development mode
if (ENVIRONMENT !== 'production') {
  development(bot);
}
