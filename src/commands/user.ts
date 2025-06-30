import { Context, Markup, Telegraf, CallbackQuery } from 'telegraf';
import { checkAccess, generateToken, saveToken, getSubjects, getChapters, getContent, checkToken, grantAccess, getUnusedToken } from '../utils/firebase';
import { paginate } from '../utils/pagination';
import axios from 'axios';

interface MyContext extends Context {
  session: {
    state?: string;
  };
}

const ADMIN_IDS = ['6930703214', '6930903213'];
const TOPIC_GROUP_ID = '-1002813390895'; // Replace with actual topic group chat ID

export function user(bot: Telegraf<MyContext>) {
  return async (ctx: MyContext) => {
    const userId = ctx.from?.id.toString();
    if (!userId) {
      console.error('No user ID found in context');
      return;
    }

    try {
      const hasAccess = await checkAccess(userId);
      
      if (hasAccess) {
        const subjects = await getSubjects();
        await ctx.reply('Select a subject:', paginate(subjects, 0, 'subject'));
        ctx.session = { ...ctx.session, state: 'subject' };
      } else {
        await ctx.reply('Hey dear, welcome! To access all lectures of Yakeen 2.0 2026, you need to generate a token. Please click the following to continue for 24 hours (to access all lectures).');

        const existingToken = await getUnusedToken(userId);
        let token: string;
        if (existingToken) {
          token = existingToken;
        } else {
          token = await generateToken(userId);
          await saveToken(token, userId, ctx.from?.username || '');
        }

        const apiKey = process.env.ADRINOLINK_API_KEY || '';
        if (!apiKey) {
          throw new Error('ADRINOLINK_API_KEY is not set');
        }

        const url = `https://t.me/NeetJeestudy_bot?text=${token}`;
        const alias = `${userId}-${token.split('-')[2]}-TIME`;
        const response = await axios.get(`https://adrinolinks.in/api?api=${apiKey}&url=${encodeURIComponent(url)}&alias=${alias}`);
        const shortLink = response.data.shortenedUrl;
        if (!shortLink || response.data.status !== 'success') {
          throw new Error(`Adrinolink API failed: ${JSON.stringify(response.data)}`);
        }
        await ctx.reply(`Click the link below to get 24-hour access:\n${shortLink}`);
      }
    } catch (error) {
      console.error('Error in user handler:', error);
      const errorMessage = `Error for user ${userId} (@${ctx.from?.username || 'unknown'}): ${error instanceof Error ? error.message : 'Unknown error'}`;
      for (const adminId of ADMIN_IDS) {
        await bot.telegram.sendMessage(adminId, errorMessage).catch(err => {
          console.error(`Failed to send error to admin ${adminId}:`, err);
        });
      }
      await ctx.reply('Failed to process your request. Please contact the admin: @itzfew');
    }
  };

  bot.on('text', async (textCtx: MyContext) => {
    try {
      if (textCtx.message && 'text' in textCtx.message && typeof textCtx.message.text === 'string' && textCtx.message.text.startsWith('Token-')) {
        const tokenData = await checkToken(textCtx.message.text);
        if (tokenData && !tokenData.used) {
          await grantAccess(textCtx.from?.id.toString() || '', textCtx.from?.username || '', textCtx.message.text);
          await textCtx.reply('Access granted for 24 hours!');
          const subjects = await getSubjects();
          await textCtx.reply('Select a subject:', paginate(subjects, 0, 'subject'));
          textCtx.session = { ...textCtx.session, state: 'subject' };
        } else {
          await textCtx.reply('Invalid or already used token.');
        }
      }
    } catch (error) {
      console.error('Error in text handler:', error);
      const errorMessage = `Error for user ${textCtx.from?.id} (@${textCtx.from?.username || 'unknown'}): ${error instanceof Error ? error.message : 'Unknown error'}`;
      for (const adminId of ADMIN_IDS) {
        await bot.telegram.sendMessage(adminId, errorMessage).catch(err => {
          console.error(`Failed to send error to admin ${adminId}:`, err);
        });
      }
      await textCtx.reply('Failed to process token. Please contact the admin: @itzfew');
    }
  });

  bot.on('callback_query', async (queryCtx: MyContext) => {
    try {
      const callbackQuery = queryCtx.callbackQuery;
      if (!callbackQuery || !('data' in callbackQuery)) return;

      // Type guard to ensure callbackQuery has 'data' property
      if (!isCallbackQueryWithData(callbackQuery)) {
        await queryCtx.reply('Invalid callback query.');
        return;
      }

      const data = callbackQuery.data;
      if (data.startsWith('subject_')) {
        const subject = data.split('_')[1];
        const chapters = await getChapters(subject);
        await queryCtx.reply('Select a chapter:', paginate(chapters, 0, `chapter_${subject}`));
        queryCtx.session = { ...queryCtx.session, state: `chapter_${subject}` };
      } else if (data.startsWith('chapter_')) {
        const [_, subject, chapter] = data.split('_');
        await queryCtx.reply('Select content type:', Markup.inlineKeyboard([
          [Markup.button.callback('DPP', `content_${subject}_${chapter}_DPP`)],
          [Markup.button.callback('Notes', `content_${subject}_${chapter}_Notes`)],
          [Markup.button.callback('Lectures', `content_${subject}_${chapter}_Lectures`)]
        ]));
        queryCtx.session = { ...queryCtx.session, state: `content_${subject}_${chapter}` };
      } else if (data.startsWith('content_')) {
        const [_, subject, chapter, contentType] = data.split('_');
        const content = await getContent(subject, chapter, contentType);
        const buttons = Object.keys(content).map(num => 
          [Markup.button.callback(`Lecture ${num}`, `lecture_${subject}_${chapter}_${contentType}_${num}`)]
        );
        await queryCtx.reply('Available lectures:', Markup.inlineKeyboard(buttons));
      } else if (data.startsWith('lecture_')) {
        const [_, subject, chapter, contentType, lectureNum] = data.split('_');
        const content = await getContent(subject, chapter, contentType);
        const messageId = content[lectureNum];
        if (messageId) {
          const [topicId, msgId] = messageId.split('/');
          await queryCtx.telegram.forwardMessage(
            queryCtx.chat?.id!,
            TOPIC_GROUP_ID,
            parseInt(msgId),
            { message_thread_id: parseInt(topicId) }
          );
        } else {
          await queryCtx.reply('Lecture not found.');
        }
      }
    } catch (error) {
      console.error('Error in callback_query handler:', error);
      const errorMessage = `Error for user ${queryCtx.from?.id} (@${queryCtx.from?.username || 'unknown'}): Message ID ${(queryCtx.callbackQuery && 'data' in queryCtx.callbackQuery) ? queryCtx.callbackQuery.data : 'unknown'} in group ${TOPIC_GROUP_ID}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      for (const adminId of ADMIN_IDS) {
        await bot.telegram.sendMessage(adminId, errorMessage).catch(err => {
          console.error(`Failed to send error to admin ${adminId}:`, err);
        });
      }
      await queryCtx.reply('Failed to process your request. Please contact the admin: @itzfew');
    }
  });
}

// Type guard to check if callbackQuery has 'data' property
function isCallbackQueryWithData(query: CallbackQuery): query is CallbackQuery & { data: string } {
  return 'data' in query;
}
