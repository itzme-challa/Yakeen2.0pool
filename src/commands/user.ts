import { Context, Markup, Telegraf } from 'telegraf';
import { checkAccess, saveToken, getSubjects, getChapters, getContent, checkToken, grantAccess, findExistingToken } from '../utils/firebase';
import { paginate } from '../utils/pagination';
import axios from 'axios';

interface MyContext extends Context {
  session: {
    state?: string;
  };
}

// Helper function to generate random ID (6 characters)
function generateRandomId(length: number = 6): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Helper function to format date as DDMMYYYY
function getFormattedDate(): string {
  const date = new Date();
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear().toString();
  return `${day}${month}${year}`;
}

// Helper function to parse messageId (e.g., "1>92/123" -> { lectureNum: "1", threadId: "92", messageId: "123" })
function parseMessageId(messageId: string): { lectureNum: string; threadId: string; messageId: string } | null {
  const match = messageId.match(/^(\d+)>(\d+)\/(\d+)$/);
  if (!match) return null;
  return {
    lectureNum: match[1],
    threadId: match[2],
    messageId: match[3]
  };
}

// Helper function to generate or retrieve token
async function getOrGenerateToken(userId: string): Promise<string> {
  const today = getFormattedDate();
  // Check for existing unused token for today
  const existingToken = await findExistingToken(userId, today);
  if (existingToken) {
    return existingToken;
  }
  // Generate new token
  const randomId = generateRandomId(6);
  return `Token-${userId}-${randomId}-${today}`;
}

async function notifyAdmins(bot: Telegraf<MyContext>, userId: string, username: string, error: any, context: string) {
  const adminChatId = process.env.ADMIN_CHAT_ID || '';
  if (!adminChatId) {
    console.error('Admin chat ID not configured.');
    return;
  }
  const errorMessage = `Error in ${context}:\nUser ID: ${userId}\nUsername: ${username || 'Unknown'}\nError: ${error.message || JSON.stringify(error)}`;
  try {
    await bot.telegram.sendMessage(adminChatId, errorMessage);
  } catch (notifyError) {
    console.error('Failed to notify admins:', notifyError);
  }
}

export function user(bot: Telegraf<MyContext>) {
  return async (ctx: MyContext) => {
    const userId = ctx.from?.id.toString();
    const username = ctx.from?.username || 'Unknown';
    if (!userId) {
      ctx.reply('Error: User ID not found.');
      await notifyAdmins(bot, 'Unknown', username, new Error('User ID not found'), 'user handler');
      return;
    }

    const hasAccess = await checkAccess(userId);
    
    if (hasAccess) {
      const subjects = await getSubjects();
      ctx.reply('Select a subject:', paginate(subjects, 0, 'subject'));
      ctx.session = { ...ctx.session, state: 'subject' };
    } else {
      const token = await getOrGenerateToken(userId);
      await saveToken(token, userId, username);

      const apiKey = process.env.ADRINOLINK_API_KEY || '';
      if (!apiKey) {
        ctx.reply('Error: API key is missing.');
        await notifyAdmins(bot, userId, username, new Error('API key is missing'), 'link shortening');
        return;
      }

      // Generate alias: xxx-zzz-kkk
      const date = getFormattedDate(); // DDMMYYYY (8 chars)
      const userIdPart = userId.slice(0, 8); // Limit userId to 8 chars
      const randomId = generateRandomId(6); // 6-char random ID
      const alias = `${userIdPart}-${date}-${randomId}`.slice(0, 30); // Ensure under 30 chars

      const url = `https://t.me/NeetJeestudy_bot?text=${token}`;
      try {
        const response = await axios.get(`https://adrinolinks.in/api?api=${apiKey}&url=${encodeURIComponent(url)}&alias=${alias}`);
        console.log('AdrinoLinks API response:', response.data);

        if (response.data.status === 'success' && response.data.shortenedUrl) {
          ctx.reply(`Click the link below to get 24-hour access:\n${response.data.shortenedUrl}`);
        } else {
          ctx.reply('Error: Failed to shorten the link. Please try again later.');
          await notifyAdmins(bot, userId, username, new Error(`Invalid API response: ${JSON.stringify(response.data)}`), 'link shortening');
        }
      } catch (error) {
        console.error('Error shortening link:', error);
        ctx.reply('Error: Unable to generate access link. Please try again later.');
        await notifyAdmins(bot, userId, username, error, 'link shortening');
      }
    }

    bot.on('text', async (textCtx: MyContext) => {
      const textUserId = textCtx.from?.id.toString() || 'Unknown';
      const textUsername = textCtx.from?.username || 'Unknown';
      if (textCtx.message && 'text' in textCtx.message && typeof textCtx.message.text === 'string' && textCtx.message.text.startsWith('Token-')) {
        try {
          const tokenData = await checkToken(textCtx.message.text);
          if (tokenData && !tokenData.used) {
            await grantAccess(textUserId, textUsername, textCtx.message.text);
            textCtx.reply('Access granted for 24 hours!');
            const subjects = await getSubjects();
            textCtx.reply('Select a subject:', paginate(subjects, 0, 'subject'));
            textCtx.session = { ...textCtx.session, state: 'subject' };
          } else {
            textCtx.reply('Invalid or already used token.');
          }
        } catch (error) {
          console.error('Error processing token:', error);
          textCtx.reply('Error: Failed to process token. Please try again.');
          await notifyAdmins(bot, textUserId, textUsername, error, 'token processing');
        }
      }
    });

    bot.on('callback_query', async (queryCtx: MyContext) => {
      const queryUserId = queryCtx.from?.id.toString() || 'Unknown';
      const queryUsername = queryCtx.from?.username || 'Unknown';
      const callbackQuery = queryCtx.callbackQuery;
      if (!callbackQuery || !('data' in callbackQuery)) {
        await notifyAdmins(bot, queryUserId, queryUsername, new Error('Invalid callback query'), 'callback handler');
        return;
      }

      const data = callbackQuery.data;
      try {
        if (data.startsWith('subject_')) {
          const subject = data.split('_')[1];
          const chapters = await getChapters(subject);
          queryCtx.reply('Select a chapter:', paginate(chapters, 0, `chapter_${subject}`));
          queryCtx.session = { ...queryCtx.session, state: `chapter_${subject}` };
        } else if (data.startsWith('chapter_')) {
          const [_, subject, chapter] = data.split('_');
          queryCtx.reply('Select content type:', Markup.inlineKeyboard([
            [Markup.button.callback('DPP', `content_${subject}_${chapter}_DPP`)],
            [Markup.button.callback('Notes', `content_${subject}_${chapter}_Notes`)],
            [Markup.button.callback('Lectures', `content_${subject}_${chapter}_Lectures`)]
          ]));
          queryCtx.session = { ...queryCtx.session, state: `content_${subject}_${chapter}` };
        } else if (data.startsWith('content_')) {
          const [_, subject, chapter, contentType] = data.split('_');
          const content = await getContent(subject, chapter, contentType);
          console.log(`Content for ${subject}/${chapter}/${contentType}:`, content); // Debug log
          const buttons = Object.keys(content).map(num => 
            [Markup.button.callback(`Lecture ${num}`, `lecture_${subject}_${chapter}_${contentType}_${num}`)]
          );
          queryCtx.reply('Available lectures:', Markup.inlineKeyboard(buttons));
        } else if (data.startsWith('lecture_')) {
          const [_, subject, chapter, contentType, lectureNum] = data.split('_');
          const content = await getContent(subject, chapter, contentType);
          const messageId = content[lectureNum];
          console.log(`Processing lecture: subject=${subject}, chapter=${chapter}, contentType=${contentType}, lectureNum=${lectureNum}, messageId=${messageId}`); // Debug log
          if (messageId) {
            const parsed = parseMessageId(messageId);
            if (parsed) {
              const { threadId, messageId: actualMessageId } = parsed;
              console.log(`Forwarding message: threadId=${threadId}, messageId=${actualMessageId}`); // Debug log
              try {
                await queryCtx.telegram.forwardMessage(
                  queryCtx.chat?.id!,
                  process.env.GROUP_CHAT_ID || '-1002813390895',
                  parseInt(actualMessageId),
                  { message_thread_id: parseInt(threadId) } // Specify thread ID
                );
              } catch (forwardError) {
                console.error('Forward message error:', forwardError);
                queryCtx.reply('Error: Unable to forward the lecture. Please try again later.');
                await notifyAdmins(
                  bot,
                  queryUserId,
                  queryUsername,
                  new Error(`Failed to forward message: ${forwardError.message || JSON.stringify(forwardError)}`),
                  `lecture forwarding: ${subject}/${chapter}/${contentType}/${lectureNum}`
                );
              }
            } else {
              queryCtx.reply('Error: Invalid lecture message format.');
              await notifyAdmins(
                bot,
                queryUserId,
                queryUsername,
                new Error(`Invalid messageId format: ${messageId} for ${subject}_${chapter}_${contentType}_${lectureNum}`),
                'lecture retrieval'
              );
            }
          } else {
            queryCtx.reply('Lecture not found.');
            await notifyAdmins(
              bot,
              queryUserId,
              queryUsername,
              new Error(`Lecture not found: ${subject}_${chapter}_${contentType}_${lectureNum}`),
              'lecture retrieval'
            );
          }
        }
      } catch (error) {
        console.error('Error in callback handler:', error);
        queryCtx.reply('Error: Something went wrong. Please try again.');
        await notifyAdmins(bot, queryUserId, queryUsername, error, 'callback handler');
      }
    });
  };
}
