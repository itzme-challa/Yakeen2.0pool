import { Context, Markup, Telegraf } from 'telegraf';
import { checkAccess, saveToken, getSubjects, getChapters, getContent, checkToken, grantAccess, findExistingToken } from '../utils/firebase';
import { paginate } from '../utils/pagination';
import axios from 'axios';

interface MyContext extends Context {
  session: {
    state?: string;
    messageId?: number;
    subject?: string;
    chapter?: string;
    contentType?: string;
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

// Helper function to generate or retrieve token
async function getOrGenerateToken(userId: string): Promise<string> {
  const today = getFormattedDate();
  const existingToken = await findExistingToken(userId, today);
  if (existingToken) {
    return existingToken;
  }
  const randomId = generateRandomId(6);
  return `Token-${userId}-${randomId}-${today}`;
}

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

export function user(bot: Telegraf<MyContext>) {
  return (ctx: MyContext) => {
    const userId = ctx.from?.id.toString();
    const username = ctx.from?.username || 'Unknown';
    if (!userId) {
      ctx.reply('Error: User ID not found.');
      notifyAdmins(bot, 'Unknown', username, new Error('User ID not found'), 'user handler');
      return;
    }

    checkAccess(userId).then(hasAccess => {
      if (hasAccess) {
        getSubjects().then(subjects => {
          const pagination = paginate(subjects, 0, 'user_subject');
          ctx.reply('Select a subject:', pagination.reply_markup).then(msg => {
            ctx.session = { ...ctx.session, state: 'user_subject', messageId: msg.message_id };
          });
        }).catch(error => {
          ctx.reply('Error fetching subjects.');
          notifyAdmins(bot, userId, username, error, 'fetch subjects');
        });
      } else {
        getOrGenerateToken(userId).then(token => {
          saveToken(token, userId, username).then(() => {
            const apiKey = process.env.ADRINOLINK_API_KEY || '';
            if (!apiKey) {
              ctx.reply('Error: API key is missing.');
              notifyAdmins(bot, userId, username, new Error('API key is missing'), 'link shortening');
              return;
            }

            const date = getFormattedDate();
            const userIdPart = userId.slice(0, 8);
            const randomId = generateRandomId(6);
            const alias = `${userIdPart}-${date}-${randomId}`.slice(0, 30);

            const url = `https://t.me/NeetJeestudy_bot?text=${token}`;
            axios.get(`https://adrinolinks.in/api?api=${apiKey}&url=${encodeURIComponent(url)}&alias=${alias}`)
              .then(response => {
                console.log('AdrinoLinks API response:', response.data);
                if (response.data.status === 'success' && response.data.shortenedUrl) {
                  ctx.reply(`Click the link below to get 24-hour access:\n${response.data.shortenedUrl}`);
                } else {
                  ctx.reply('Error: Failed to shorten the link. Please try again later.');
                  notifyAdmins(bot, userId, username, new Error(`Invalid API response: ${JSON.stringify(response.data)}`), 'link shortening');
                }
              })
              .catch(error => {
                console.error('Error shortening link:', error);
                ctx.reply('Error: Unable to generate access link. Please try again later.');
                notifyAdmins(bot, userId, username, error, 'link shortening');
              });
          }).catch(error => {
            ctx.reply('Error saving token.');
            notifyAdmins(bot, userId, username, error, 'save token');
          });
        }).catch(error => {
          ctx.reply('Error generating token.');
          notifyAdmins(bot, userId, username, error, 'generate token');
        });
      }
    }).catch(error => {
      ctx.reply('Error checking access.');
      notifyAdmins(bot, userId, username, error, 'check access');
    });
  };
}

export function registerUserHandlers(bot: Telegraf<MyContext>) {
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
          const pagination = paginate(subjects, 0, 'user_subject');
          textCtx.reply('Select a subject:', pagination.reply_markup).then(msg => {
            textCtx.session = { ...textCtx.session, state: 'user_subject', messageId: msg.message_id };
          });
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
      await queryCtx.answerCbQuery();
      return;
    }

    const data = callbackQuery.data;
    try {
      if (data === 'back') {
        const { state, subject, chapter, contentType } = queryCtx.session || {};
        if (state?.startsWith('content_')) {
          const [, selectedSubject, selectedChapter] = state.split('_');
          const chapters = await getChapters(selectedSubject);
          const pagination = paginate(chapters, 0, `user_chapter_${selectedSubject}`);
          await queryCtx.telegram.editMessageText(
            queryCtx.chat?.id!,
            queryCtx.session?.messageId!,
            undefined,
            'Select a chapter:',
            pagination.reply_markup
          );
          queryCtx.session = { ...queryCtx.session, state: `user_chapter_${selectedSubject}`, chapter: undefined, contentType: undefined };
        } else if (state?.startsWith('lecture_')) {
          const [, selectedSubject, selectedChapter, selectedContentType] = state.split('_');
          const buttons = [
            [Markup.button.callback('DPP', `content_${selectedSubject}_${selectedChapter}_DPP`)],
            [Markup.button.callback('Notes', `content_${selectedSubject}_${selectedChapter}_Notes`)],
            [Markup.button.callback('Lectures', `content_${selectedSubject}_${selectedChapter}_Lectures`)],
            [Markup.button.callback('Back', 'back')]
          ];
          await queryCtx.telegram.editMessageText(
            queryCtx.chat?.id!,
            queryCtx.session?.messageId!,
            undefined,
            'Select content type:',
            Markup.inlineKeyboard(buttons)
          );
          queryCtx.session = { ...queryCtx.session, state: `content_${selectedSubject}_${selectedChapter}`, contentType: undefined };
        } else if (state?.startsWith('user_chapter_')) {
          const subjects = await getSubjects();
          const pagination = paginate(subjects, 0, 'user_subject');
          await queryCtx.telegram.editMessageText(
            queryCtx.chat?.id!,
            queryCtx.session?.messageId!,
            undefined,
            'Select a subject:',
            pagination.reply_markup
          );
          queryCtx.session = { ...queryCtx.session, state: 'user_subject', subject: undefined, chapter: undefined, contentType: undefined };
        }
      } else if (data.startsWith('paginate_user_')) {
        const [_, __, prefix, action, pageStr] = data.split('_');
        const page = parseInt(pageStr);
        if (isNaN(page)) {
          queryCtx.reply('Error: Invalid page number.');
          await queryCtx.answerCbQuery();
          return;
        }

        let items: string[];
        let replyText: string;
        if (prefix === 'subject') {
          items = await getSubjects();
          replyText = 'Select a subject:';
        } else if (prefix.startsWith('chapter_')) {
          const subject = prefix.split('_')[1];
          items = await getChapters(subject);
          replyText = 'Select a chapter:';
        } else {
          queryCtx.reply('Error: Invalid pagination context.');
          await queryCtx.answerCbQuery();
          return;
        }

        const pagination = paginate(items, page, `user_${prefix}`);
        if (pagination.totalPages <= page || page < 0) {
          queryCtx.reply('Error: Page out of bounds.');
          await queryCtx.answerCbQuery();
          return;
        }

        try {
          await queryCtx.telegram.editMessageText(
            queryCtx.chat?.id!,
            queryCtx.session?.messageId!,
            undefined,
            replyText,
            pagination.reply_markup
          );
        } catch (editError) {
          console.warn('Failed to edit message, sending new one:', editError);
          queryCtx.reply(replyText, pagination.reply_markup).then(msg => {
            queryCtx.session = { ...queryCtx.session, messageId: msg.message_id };
          });
        }
        queryCtx.session = { ...queryCtx.session, state: `user_${prefix}` };
      } else if (data.startsWith('user_subject_')) {
        const subject = data.split('_')[2];
        const chapters = await getChapters(subject);
        const pagination = paginate(chapters, 0, `user_chapter_${subject}`);
        try {
          await queryCtx.telegram.editMessageText(
            queryCtx.chat?.id!,
            queryCtx.session?.messageId!,
            undefined,
            'Select a chapter:',
            pagination.reply_markup
          );
        } catch (editError) {
          console.warn('Failed to edit message, sending new one:', editError);
          queryCtx.reply('Select a chapter:', pagination.reply_markup).then(msg => {
            queryCtx.session = { ...queryCtx.session, messageId: msg.message_id };
          });
        }
        queryCtx.session = { ...queryCtx.session, state: `user_chapter_${subject}`, subject };
      } else if (data.startsWith('user_chapter_')) {
        const [_, __, subject, chapter] = data.split('_');
        const buttons = [
          [Markup.button.callback('DPP', `content_${subject}_${chapter}_DPP`)],
          [Markup.button.callback('Notes', `content_${subject}_${chapter}_Notes`)],
          [Markup.button.callback('Lectures', `content_${subject}_${chapter}_Lectures`)],
          [Markup.button.callback('Back', 'back')]
        ];
        try {
          await queryCtx.telegram.editMessageText(
            queryCtx.chat?.id!,
            queryCtx.session?.messageId!,
            undefined,
            'Select content type:',
            Markup.inlineKeyboard(buttons)
          );
        } catch (editError) {
          console.warn('Failed to edit message, sending new one:', editError);
          queryCtx.reply('Select content type:', Markup.inlineKeyboard(buttons)).then(msg => {
            queryCtx.session = { ...queryCtx.session, messageId: msg.message_id };
          });
        }
        queryCtx.session = { ...queryCtx.session, state: `content_${subject}_${chapter}`, chapter };
      } else if (data.startsWith('content_')) {
        const [_, subject, chapter, contentType] = data.split('_');
        const content = await getContent(subject, chapter, contentType);
        console.log(`Content for ${subject}/${chapter}/${contentType}:`, content);
        const buttons = Object.keys(content).map((num) => [
          Markup.button.callback(`${contentType} ${num}`, `lecture_${subject}_${chapter}_${contentType}_${num}`)
        ]);
        buttons.push([Markup.button.callback('Back', 'back')]);
        try {
          await queryCtx.telegram.editMessageText(
            queryCtx.chat?.id!,
            queryCtx.session?.messageId!,
            undefined,
            `Available ${contentType.toLowerCase()}:`,
            Markup.inlineKeyboard(buttons)
          );
        } catch (editError) {
          console.warn('Failed to edit message, sending new one:', editError);
          queryCtx.reply(`Available ${contentType.toLowerCase()}:`, Markup.inlineKeyboard(buttons)).then(msg => {
            queryCtx.session = { ...queryCtx.session, messageId: msg.message_id };
          });
        }
        queryCtx.session = { ...queryCtx.session, state: `lecture_${subject}_${chapter}_${contentType}`, contentType };
      } else if (data.startsWith('lecture_')) {
        const [_, subject, chapter, contentType, lectureNum] = data.split('_');
        const content = await getContent(subject, chapter, contentType);
        const messageId = content[lectureNum];
        console.log(`Processing ${contentType}: subject=${subject}, chapter=${chapter}, contentType=${contentType}, lectureNum=${lectureNum}, messageId=${messageId}`);
        if (messageId) {
          console.log(`Forwarding message: messageId=${messageId}, groupChatId=${process.env.GROUP_CHAT_ID || '-1002813390895'}`);
          try {
            await queryCtx.telegram.forwardMessage(
              queryCtx.chat?.id!,
              process.env.GROUP_CHAT_ID || '-1002813390895',
              parseInt(messageId)
            );
          } catch (forwardError: unknown) {
            const error = forwardError instanceof Error ? forwardError : new Error('Unknown error during message forwarding');
            console.error('Forward message error:', error);
            queryCtx.reply('Error: Unable to forward the content. Please try again later.');
            await notifyAdmins(
              bot,
              queryUserId,
              queryUsername,
              error,
              `content forwarding: ${subject}/${chapter}/${contentType}/${lectureNum}`
            );
          }
        } else {
          queryCtx.reply(`${contentType} not found.`);
          await notifyAdmins(
            bot,
            queryUserId,
            queryUsername,
            new Error(`Content not found: ${subject}_${chapter}_${contentType}_${lectureNum}`),
            'content retrieval'
          );
        }
      }
    } catch (error: unknown) {
      console.error('Error in callback handler:', error);
      queryCtx.reply('Error: Something went wrong. Please try again.');
      await notifyAdmins(bot, queryUserId, queryUsername, error, 'callback handler');
    } finally {
      await queryCtx.answerCbQuery();
    }
  });
}
