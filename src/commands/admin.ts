import { Telegraf, Context } from 'telegraf';
import { saveContent } from './utils/firebase';

interface MyContext extends Context {
  session: {
    state?: string;
    subject?: string;
    chapter?: string;
    contentType?: string;
  };
}

export function admin(bot: Telegraf<MyContext>) {
  return async (ctx: MyContext) => {
    // Check if user is admin (replace with actual admin ID check)
    const adminId = process.env.ADMIN_ID || '6930703214';
    if (ctx.from?.id.toString() !== adminId) {
      await ctx.reply('You are not authorized to use this command.');
      return;
    }

    // Parse command: /admin subject_name & chapter_name & content_type
    const commandText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = commandText.split(' ').slice(1).join(' ').split('&').map(part => part.trim());

    if (parts.length !== 3) {
      await ctx.reply('Invalid format. Use: /admin subject_name & chapter_name & content_type');
      return;
    }

    const [subject, chapter, contentType] = parts;

    // Validate contentType
    if (!['DPP', 'Lectures', 'Notes'].includes(contentType)) {
      await ctx.reply('Invalid content type. Must be DPP, Lectures, or Notes.');
      return;
    }

    // Store in session
    ctx.session = {
      state: 'awaiting_message_ids',
      subject,
      chapter,
      contentType
    };

    await ctx.reply('Please provide message IDs in the format: 1,88;2,89;3,90 (number,message_id pairs separated by semicolons)');
  };
}

export function registerAdminHandlers(bot: Telegraf<MyContext>) {
  bot.on('text', async (ctx) => {
    if (ctx.session?.state !== 'awaiting_message_ids') return;

    const { subject, chapter, contentType } = ctx.session;
    if (!subject || !chapter || !contentType) {
      await ctx.reply('Session error. Please start again with /admin command.');
      return;
    }

    // Check if user is admin
    const adminId = process.env.ADMIN_ID || 'YOUR_ADMIN_ID';
    if (ctx.from?.id.toString() !== adminId) {
      await ctx.reply('You are not authorized to perform this action.');
      return;
    }

    // Parse message IDs: 1,88;2,89;3,90
    const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const pairs = messageText.split(';').map(pair => pair.trim());

    const messageIds: Record<string, string> = {};
    for (const pair of pairs) {
      const [number, messageId] = pair.split(',').map(item => item.trim());
      if (!number || !messageId || isNaN(parseInt(number)) || isNaN(parseInt(messageId))) {
        await ctx.reply(`Invalid pair: ${pair}. Use format: number,message_id (e.g., 1,88)`);
        return;
      }
      messageIds[number] = messageId;
    }

    try {
      // Save to Firebase
      await saveContent(subject, chapter, contentType, messageIds);
      await ctx.reply(`Successfully saved ${Object.keys(messageIds).length} message IDs for ${subject}/${chapter}/${contentType}`);
      // Clear session
      ctx.session.state = undefined;
      ctx.session.subject = undefined;
      ctx.session.chapter = undefined;
      ctx.session.contentType = undefined;
    } catch (error) {
      console.error('Error saving content:', error);
      await ctx.reply('Error saving message IDs. Please try again.');
    }
  });
}
