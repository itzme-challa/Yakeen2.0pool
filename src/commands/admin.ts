import { Context, Markup, Telegraf } from 'telegraf';
import { saveContent, getSubjects, getChapters } from '../utils/firebase';
import { paginate } from '../utils/pagination';

interface MyContext extends Context {
  session: {
    state?: string;
    messageId?: number;
    subject?: string;
    chapter?: string;
    contentType?: string;
  };
}

const ADMIN_IDS = ['6930703214', '6930903213'];

// Helper function to notify admins
async function notifyAdmins(bot: Telegraf<MyContext>, userId: string, username: string, error: unknown, context: string) {
  const adminChatId = process.env.ADMIN_CHAT_ID || '';
  if (!adminChatId) {
    console.error('Admin chat ID not configured.');
    return;
  }
  const errorMessage = `Error in ${context}:\nUser ID: ${userId}\nUsername: ${username || 'Unknown'}\nError: ${
    error instanceof Error ? error.message : JSON.stringify(error)
  }`;
  try {
    await bot.telegram.sendMessage(adminChatId, errorMessage);
  } catch (notifyError) {
    console.error('Failed to notify admins:', notifyError);
  }
}

export function admin(bot: Telegraf<MyContext>) {
  return async (ctx: MyContext) => {
    const userId = ctx.from?.id.toString();
    const username = ctx.from?.username || 'Unknown';
    if (!userId) {
      ctx.reply('Error: User ID not found.');
      await notifyAdmins(bot, 'Unknown', username, new Error('User ID not found'), 'admin handler');
      return;
    }

    if (!ADMIN_IDS.includes(userId)) {
      ctx.reply('Error: You are not authorized to use this command.');
      await notifyAdmins(bot, userId, username, new Error('Unauthorized access attempt'), 'admin handler');
      return;
    }

    const commandText = ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string' ? ctx.message.text : '';
    const commandParts = commandText.split(':').map(part => part.trim());

    if (commandParts.length === 2 && commandParts[0].startsWith('/admin')) {
      const [params, contentData] = commandParts;
      const paramParts = params.replace('/admin', '').split(',').map(p => p.trim());
      if (paramParts.length !== 3 || !paramParts[2].startsWith('Type ')) {
        ctx.reply('Error: Invalid command format. Use /admin subject,chapter,Type contentType: num1,msgid1;num2,msgid2;...');
        return;
      }

      const subject = paramParts[0];
      const chapter = paramParts[1];
      const contentTypeMatch = paramParts[2].match(/^Type\s+(\w+)/);
      if (!contentTypeMatch) {
        ctx.reply('Error: Invalid content type. Use DPP, Notes, or Lectures.');
        return;
      }
      const contentType = contentTypeMatch[1];
      if (!['DPP', 'Notes', 'Lectures'].includes(contentType)) {
        ctx.reply('Error: Content type must be DPP, Notes, or Lectures.');
        return;
      }

      const contentPairs = contentData.split(';').map(pair => pair.trim()).filter(pair => pair);
      const contentMap: { [key: string]: string } = {};
      for (const pair of contentPairs) {
        const [num, msgId] = pair.split(',').map(p => p.trim());
        if (!num || !msgId || isNaN(parseInt(num)) || isNaN(parseInt(msgId))) {
          ctx.reply(`Error: Invalid pair format in "${pair}". Use num,msgid;num,msgid;...`);
          return;
        }
        contentMap[num] = msgId;
      }

      try {
        await saveContent(subject, chapter, contentType, contentMap);
        ctx.reply(`Successfully saved ${contentType} content for ${subject}/${chapter}.`);
      } catch (error) {
        console.error('Error saving content:', error);
        ctx.reply('Error: Failed to save content. Please try again.');
        await notifyAdmins(bot, userId, username, error, `save content: ${subject}/${chapter}/${contentType}`);
      }
    } else {
      // Fallback to subject selection if no specific command parameters
      const subjects = await getSubjects();
      const pagination = paginate(subjects, 0, 'admin_subject');
      try {
        const msg = await ctx.reply('Select a subject:', pagination.reply_markup);
        ctx.session = { ...ctx.session, state: 'admin_subject', messageId: msg.message_id };
      } catch (error) {
        await notifyAdmins(bot, userId, username, error, 'subject list display');
        ctx.reply('Error displaying subjects. Please try again.');
      }
    }
  };
}

export function registerAdminHandlers(bot: Telegraf<MyContext>) {
  bot.on('callback_query', async (queryCtx: MyContext) => {
    const queryUserId = queryCtx.from?.id.toString() || 'Unknown';
    const queryUsername = queryCtx.from?.username || 'Unknown';
    if (!ADMIN_IDS.includes(queryUserId)) {
      queryCtx.reply('Error: You are not authorized to use this command.');
      await notifyAdmins(bot, queryUserId, queryUsername, new Error('Unauthorized callback attempt'), 'admin callback handler');
      return;
    }

    const callbackQuery = queryCtx.callbackQuery;
    if (!callbackQuery || !('data' in callbackQuery)) {
      await notifyAdmins(bot, queryUserId, queryUsername, new Error('Invalid callback query'), 'admin callback handler');
      return;
    }

    const data = callbackQuery.data;
    try {
      if (data.startsWith('paginate_admin_')) {
        const [_, __, prefix, action, pageStr] = data.split('_');
        const page = parseInt(pageStr);
        if (isNaN(page)) {
          queryCtx.reply('Error: Invalid page number.');
          return;
        }

        let items: string[];
        let messageText: string;
        if (prefix === 'subject') {
          items = await getSubjects();
          messageText = 'Select a subject:';
        } else if (prefix.startsWith('chapter_')) {
          const subject = prefix.split('_')[1];
          items = await getChapters(subject);
          messageText = 'Select a chapter:';
        } else {
          queryCtx.reply('Error: Invalid pagination context.');
          return;
        }

        const pagination = paginate(items, page, `admin_${prefix}`);
        if (pagination.totalPages <= page || page < 0) {
          queryCtx.reply('Error: Page out of bounds.');
          return;
        }

        try {
          await queryCtx.telegram.editMessageText(
            queryCtx.chat?.id!,
            queryCtx.session?.messageId!,
            undefined,
            messageText,
            pagination.reply_markup
          );
          queryCtx.session = { ...queryCtx.session, state: `admin_${prefix}` };
        } catch (editError) {
          console.warn('Failed to edit message, sending new one:', editError);
          const msg = await queryCtx.reply(messageText, pagination.reply_markup);
          queryCtx.session = { ...queryCtx.session, state: `admin_${prefix}`, messageId: msg.message_id };
        }
      } else if (data === 'back') {
        if (queryCtx.session?.state?.startsWith('admin_chapter_')) {
          const subjects = await getSubjects();
          const pagination = paginate(subjects, 0, 'admin_subject');
          try {
            await queryCtx.telegram.editMessageText(
              queryCtx.chat?.id!,
              queryCtx.session?.messageId!,
              undefined,
              'Select a subject:',
              pagination.reply_markup
            );
            queryCtx.session = { ...queryCtx.session, state: 'admin_subject' };
          } catch (editError) {
            console.warn('Failed to edit message for back, sending new one:', editError);
            const msg = await queryCtx.reply('Select a subject:', pagination.reply_markup);
            queryCtx.session = { ...queryCtx.session, state: 'admin_subject', messageId: msg.message_id };
          }
        } else if (queryCtx.session?.state?.startsWith('admin_content_')) {
          const subject = queryCtx.session.state.split('_')[2];
          const chapters = await getChapters(subject);
          const pagination = paginate(chapters, 0, `admin_chapter_${subject}`);
          try {
            await queryCtx.telegram.editMessageText(
              queryCtx.chat?.id!,
              queryCtx.session?.messageId!,
              undefined,
              'Select a chapter:',
              pagination.reply_markup
            );
            queryCtx.session = { ...queryCtx.session, state: `admin_chapter_${subject}` };
          } catch (editError) {
            console.warn('Failed to edit message for back, sending new one:', editError);
            const msg = await queryCtx.reply('Select a chapter:', pagination.reply_markup);
            queryCtx.session = { ...queryCtx.session, state: `admin_chapter_${subject}`, messageId: msg.message_id };
          }
        }
      } else if (data.startsWith('admin_subject_')) {
        const subject = data.split('_')[2];
        const chapters = await getChapters(subject);
        const pagination = paginate(chapters, 0, `admin_chapter_${subject}`);
        try {
          await queryCtx.telegram.editMessageText(
            queryCtx.chat?.id!,
            queryCtx.session?.messageId!,
            undefined,
            'Select content type:',
            Markup.inlineKeyboard([
              [Markup.button.callback('DPP', `admin_content_${subject}_DPP`)],
              [Markup.button.callback('Notes', `admin_content_${subject}_Notes`)],
              [Markup.button.callback('Lectures', `admin_content_${subject}_Lectures`)],
              [Markup.button.callback('Back', 'back')]
            ])
          );
          queryCtx.session = { ...queryCtx.session, state: `admin_content_${subject}`, subject };
        } catch (editError) {
          console.warn('Failed to edit message, sending new one:', editError);
          const msg = await queryCtx.reply('Select content type:', Markup.inlineKeyboard([
            [Markup.button.callback('DPP', `admin_content_${subject}_DPP`)],
            [Markup.button.callback('Notes', `admin_content_${subject}_Notes`)],
            [Markup.button.callback('Lectures', `admin_content_${subject}_Lectures`)],
            [Markup.button.callback('Back', 'back')]
          ]));
          queryCtx.session = { ...queryCtx.session, state: `admin_content_${subject}`, subject, messageId: msg.message_id };
        }
      } else if (data.startsWith('admin_content_')) {
        const [_, __, subject, contentType] = data.split('_');
        try {
          await queryCtx.telegram.editMessageText(
            queryCtx.chat?.id!,
            queryCtx.session?.messageId!,
            undefined,
            `Please enter the chapter and message IDs in the format: chapter:num1,msgid1;num2,msgid2;...`,
            Markup.inlineKeyboard([[Markup.button.callback('Back', 'back')]])
          );
          queryCtx.session = { ...queryCtx.session, state: `admin_content_${subject}_${contentType}_input`, subject, contentType };
        } catch (editError) {
          console.warn('Failed to edit message, sending new one:', editError);
          const msg = await queryCtx.reply(
            `Please enter the chapter and message IDs in the format: chapter:num1,msgid1;num2,msgid2;...`,
            Markup.inlineKeyboard([[Markup.button.callback('Back', 'back')]])
          );
          queryCtx.session = { ...queryCtx.session, state: `admin_content_${subject}_${contentType}_input`, subject, contentType, messageId: msg.message_id };
        }
      }
    } catch (error) {
      console.error('Error in admin callback handler:', error);
      queryCtx.reply('Error: Something went wrong. Please try again.');
      await notifyAdmins(bot, queryUserId, queryUsername, error, 'admin callback handler');
    } finally {
      await queryCtx.answerCbQuery();
    }
  });

  bot.on('text', async (textCtx: MyContext) => {
    const textUserId = textCtx.from?.id.toString() || 'Unknown';
    const textUsername = textCtx.from?.username || 'Unknown';
    if (!ADMIN_IDS.includes(textUserId)) {
      textCtx.reply('Error: You are not authorized to use this command.');
      await notifyAdmins(bot, textUserId, textUsername, new Error('Unauthorized text input attempt'), 'admin text handler');
      return;
    }

    if (textCtx.session?.state?.startsWith('admin_content_') && textCtx.message && 'text' in textCtx.message && typeof textCtx.message.text === 'string') {
      const [_, __, subject, contentType, __input] = textCtx.session.state.split('_');
      const input = textCtx.message.text;
      const [chapter, contentData] = input.split(':').map(part => part.trim());
      if (!chapter || !contentData) {
        textCtx.reply('Error: Invalid format. Use chapter:num1,msgid1;num2,msgid2;...');
        return;
      }

      const contentPairs = contentData.split(';').map(pair => pair.trim()).filter(pair => pair);
      const contentMap: { [key: string]: string } = {};
      for (const pair of contentPairs) {
        const [num, msgId] = pair.split(',').map(p => p.trim());
        if (!num || !msgId || isNaN(parseInt(num)) || isNaN(parseInt(msgId))) {
          textCtx.reply(`Error: Invalid pair format in "${pair}". Use num,msgid;num,msgid;...`);
          return;
        }
        contentMap[num] = msgId;
      }

      try {
        await saveContent(subject, chapter, contentType, contentMap);
        textCtx.reply(`Successfully saved ${contentType} content for ${subject}/${chapter}.`);
        // Return to subject selection
        const subjects = await getSubjects();
        const pagination = paginate(subjects, 0, 'admin_subject');
        try {
          await textCtx.telegram.editMessageText(
            textCtx.chat?.id!,
            textCtx.session?.messageId!,
            undefined,
            'Select a subject:',
            pagination.reply_markup
          );
          textCtx.session = { ...textCtx.session, state: 'admin_subject' };
        } catch (editError) {
          console.warn('Failed to edit message, sending new one:', editError);
          const msg = await textCtx.reply('Select a subject:', pagination.reply_markup);
          textCtx.session = { ...textCtx.session, state: 'admin_subject', messageId: msg.message_id };
        }
      } catch (error) {
        console.error('Error saving content:', error);
        textCtx.reply('Error: Failed to save content. Please try again.');
        await notifyAdmins(bot, textUserId, textUsername, error, `save content: ${subject}/${chapter}/${contentType}`);
      }
    }
  });
}
