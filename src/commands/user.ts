import { Context, Markup, Telegraf } from 'telegraf';
import { checkAccess, generateToken, saveToken, getSubjects, getChapters, getContent, checkToken, grantAccess, getUnusedToken } from '../utils/firebase';
import { paginate } from '../utils/pagination';
import axios from 'axios';
import { getAuth, signInAnonymously } from 'firebase/auth';

interface MyContext extends Context {
  session: {
    state?: string;
  };
}

const ADMIN_IDS = ['6930703214', '6930903213'];
const TOPIC_GROUP_ID = '-1002813390895'; // Replace with actual topic group chat ID

// Helper function to check if a timestamp is from the same day in IST
function isSameDay(timestamp: number): boolean {
  const tokenDate = new Date(timestamp);
  const now = new Date();
  // Adjust for IST (+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const tokenDateIST = new Date(tokenDate.getTime() + istOffset);
  const nowIST = new Date(now.getTime() + istOffset);

  return (
    tokenDateIST.getFullYear() === nowIST.getFullYear() &&
    tokenDateIST.getMonth() === nowIST.getMonth() &&
    tokenDateIST.getDate() === nowIST.getDate()
  );
}

export function user(bot: Telegraf<MyContext>) {
  return async (ctx: MyContext) => {
    const userId = ctx.from?.id.toString();
    if (!userId) {
      ctx.reply('Error: Unable to identify user. Please try again.');
      return;
    }

    // Initialize anonymous authentication
    try {
      const auth = getAuth();
      await signInAnonymously(auth);
    } catch (error) {
      console.error('Anonymous auth error:', error);
      ctx.reply('Authentication failed. Please try again or contact the admin: @itzfew');
      return;
    }

    try {
      const hasAccess = await checkAccess(userId);

      if (hasAccess) {
        const subjects = await getSubjects();
        if (subjects.length === 0) {
          ctx.reply('No subjects available at the moment. Please try again later.');
          return;
        }
        ctx.reply('Select a subject:', paginate(subjects, 0, 'subject'));
        ctx.session = { ...ctx.session, state: 'subject' };
      } else {
        ctx.reply('Hey dear, welcome! To access all lectures of Yakeen 2.0 2026, you need to generate a token for 24-hour access.');

        // Check for an existing unused token
        const existingTokenData = await getUnusedToken(userId);
        let token: string;
        let shortLink: string | undefined;

        if (existingTokenData && existingTokenData.token && existingTokenData.createdAt && isSameDay(existingTokenData.createdAt)) {
          token = existingTokenData.token;
          shortLink = existingTokenData.shortLink;
          if (!shortLink) {
            const apiKey = process.env.ADRINOLINK_API_KEY || '';
            const url = `https://t.me/NeetJeestudy_bot?text=${token}`;
            const now = new Date();
            const timestamp = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
            const alias = `${userId}-${token.split('-')[2]}-${timestamp}`;

            try {
              const response = await axios.get(`https://adrinolinks.in/api?api=${apiKey}&url=${encodeURIComponent(url)}&alias=${alias}`);
              shortLink = response.data.shortenedUrl;
              if (!shortLink || response.data.status !== 'success') {
                throw new Error('Failed to generate short link');
              }
              await saveToken(token, userId, ctx.from?.username || '', shortLink);
            } catch (error) {
              console.error('Adrinolink API error:', error);
              const errorMessage = `Error generating short link for user ${userId} (@${ctx.from?.username || 'unknown'}): ${error instanceof Error ? error.message : 'Unknown error'}`;
              for (const adminId of ADMIN_IDS) {
                await bot.telegram.sendMessage(adminId, errorMessage).catch(err => {
                  console.error(`Failed to send error to admin ${adminId}:`, err);
                });
              }
              ctx.reply('Failed to generate access link. Please contact the admin: @itzfew');
              return;
            }
          }
        } else {
          token = await generateToken(userId);
          const apiKey = process.env.ADRINOLINK_API_KEY || '';
          const url = `https://t.me/NeetJeestudy_bot?text=${token}`;
          const now = new Date();
          const timestamp = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
          const alias = `${userId}-${token.split('-')[2]}-${timestamp}`;

          try {
            const response = await axios.get(`https://adrinolinks.in/api?api=${apiKey}&url=${encodeURIComponent(url)}&alias=${alias}`);
            shortLink = response.data.shortenedUrl;
            if (!shortLink || response.data.status !== 'success') {
             ソーサー
            throw new Error('Failed to generate short link');
            }
            await saveToken(token, userId, ctx.from?.username || '', shortLink);
          } catch (error) {
            console.error('Adrinolink API error:', error);
            const errorMessage = `Error generating short link for user ${userId} (@${ctx.from?.username || 'unknown'}): ${error instanceof Error ? error.message : 'Unknown error'}`;
            for (const adminId of ADMIN_IDS) {
              await bot.telegram.sendMessage(adminId, errorMessage).catch(err => {
                console.error(`Failed to send error to admin ${adminId}:`, err);
              });
            }
            ctx.reply('Failed to generate access link. Please contact the admin: @itzfew');
            return;
          }
        }

        ctx.reply(`Click the link below to get 24-hour access:\n${shortLink}`);
      }
    } catch (error) {
      console.error('Error in user command:', error);
      const errorMessage = `Error processing user command for ${userId} (@${ctx.from?.username || 'unknown'}): ${error instanceof Error ? error.message : 'Unknown error'}`;
      for (const adminId of ADMIN_IDS) {
        await bot.telegram.sendMessage(adminId, errorMessage).catch(err => {
          console.error(`Failed to send error to admin ${adminId}:`, err);
        });
      }
      ctx.reply('An error occurred. Please contact the admin: @itzfew');
    }
  };
}

bot.on('text', async (textCtx: MyContext) => {
  if (!textCtx.message || !('text' in textCtx.message) || typeof textCtx.message.text !== 'string') return;

  const userId = textCtx.from?.id.toString();
  if (!userId) {
    textCtx.reply('Error: Unable to identify user. Please try again.');
    return;
  }

  try {
    if (textCtx.message.text.startsWith('Token-')) {
      const tokenData = await checkToken(textCtx.message.text);
      if (tokenData && !tokenData.used && tokenData.userid === userId) {
        await grantAccess(userId, textCtx.from?.username || '', textCtx.message.text);
        textCtx.reply('Access granted for 24 hours!');
        const subjects = await getSubjects();
        if (subjects.length === 0) {
          textCtx.reply('No subjects available at the moment. Please try again later.');
          return;
        }
        textCtx.reply('Select a subject:', paginate(subjects, 0, 'subject'));
        textCtx.session = { ...textCtx.session, state: 'subject' };
      } else {
        textCtx.reply('Invalid, used, or unauthorized token.');
      }
    }
  } catch (error) {
    console.error('Error processing token:', error);
    const errorMessage = `Error processing token for user ${userId} (@${textCtx.from?.username || 'unknown'}): ${error instanceof Error ? error.message : 'Unknown error'}`;
    for (const adminId of ADMIN_IDS) {
      await bot.telegram.sendMessage(adminId, errorMessage).catch(err => {
        console.error(`Failed to send error to admin ${adminId}:`, err);
      });
    }
    textCtx.reply('An error occurred while processing the token. Please contact the admin: @itzfew');
  }
});

bot.on('callback_query', async (queryCtx: MyContext) => {
  const callbackQuery = queryCtx.callbackQuery;
  if (!callbackQuery || !('data' in callbackQuery)) return;

  const userId = queryCtx.from?.id.toString();
  if (!userId) {
    queryCtx.reply('Error: Unable to identify user. Please try again.');
    return;
  }

  try {
    const hasAccess = await checkAccess(userId);
    if (!hasAccess) {
      queryCtx.reply('Your access has expired. Please generate a new token using /start.');
      queryCtx.session = { ...queryCtx.session, state: undefined };
      return;
    }

    const data = callbackQuery.data;
    if (data.startsWith('subject_')) {
      const subject = data.split('_')[1];
      const chapters = await getChapters(subject);
      if (chapters.length === 0) {
        queryCtx.reply('No chapters available for this subject.');
        return;
      }
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
      if (Object.keys(content).length === 0) {
        queryCtx.reply(`No ${contentType} available for this chapter.`);
        return;
      }
      const buttons = Object.keys(content).map(num => 
        [Markup.button.callback(`Lecture ${num}`, `lecture_${subject}_${chapter}_${contentType}_${num}`)]
      );
      queryCtx.reply('Available lectures:', Markup.inlineKeyboard(buttons));
    } else if (data.startsWith('lecture_')) {
      const [_, subject, chapter, contentType, lectureNum] = data.split('_');
      const content = await getContent(subject, chapter, contentType);
      const messageId = content[lectureNum];
      if (messageId) {
        const [topicId, msgId] = messageId.split('/');
        try {
          await queryCtx.telegram.forwardMessage(
            queryCtx.chat?.id!,
            TOPIC_GROUP_ID,
            parseInt(msgId),
            { message_thread_id: parseInt(topicId) }
          );
        } catch (error) {
          console.error('Message forwarding error:', error);
          const errorMessage = `Error forwarding message for user ${userId} (@${queryCtx.from?.username || 'unknown'}): Message ID ${messageId} in group ${TOPIC_GROUP_ID}`;
          for (const adminId of ADMIN_IDS) {
            await bot.telegram.sendMessage(adminId, errorMessage).catch(err => {
              console.error(`Failed to send error to admin ${adminId}:`, err);
            });
          }
          queryCtx.reply('Failed to forward lecture. Please contact the admin: @itzfew');
        }
      } else {
        queryCtx.reply('Lecture not found.');
      }
    }
  } catch (error) {
    console.error('Error in callback query:', error);
    const errorMessage = `Error processing callback query for user ${userId} (@${queryCtx.from?.username || 'unknown'}): ${error instanceof Error ? error.message : 'Unknown error'}`;
    for (const adminId of ADMIN_IDS) {
      await bot.telegram.sendMessage(adminId, errorMessage).catch(err => {
        console.error(`Failed to send error to admin ${adminId}:`, err);
      });
    }
    queryCtx.reply('An error occurred. Please contact the admin: @itzfew');
  }
});
