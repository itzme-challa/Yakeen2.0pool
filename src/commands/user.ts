import { Context, Markup, Telegraf } from 'telegraf';
import { checkAccess, generateToken, saveToken, getSubjects, getChapters, getContent, checkToken, grantAccess } from '../utils/firebase';
import { paginate } from '../utils/pagination';
import axios from 'axios';

interface MyContext extends Context {
  session: {
    state?: string;
  };
}

export function user(bot: Telegraf<MyContext>) {
  return async (ctx: MyContext) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const hasAccess = await checkAccess(userId);
    
    if (hasAccess) {
      const subjects = await getSubjects();
      ctx.reply('Select a subject:', paginate(subjects, 0, 'subject'));
      ctx.session = { ...ctx.session, state: 'subject' };
    } else {
      const date = new Date().toLocaleDateString('en-GB').replace(/\//g, '');
      const randomId = Math.random().toString(36).substring(2, 8);
      const token = `Token-${userId}-${date}-${randomId}`;

      await saveToken(token, userId, ctx.from?.username || '');

      const apiKey = process.env.ADRINOLINK_API_KEY || '';
      const url = `https://t.me/NeetJeestudy_bot?text=${token}`;
      const alias = `${userId}-${date}-TIME`;
      const response = await axios.get(`https://adrinolinks.in/api?api=${apiKey}&url=${encodeURIComponent(url)}&alias=${alias}`);
      const shortLink = response.data.shorturl;

      ctx.reply(`Click the link below to get 24-hour access:\n${shortLink}`);
    }

    bot.on('text', async (textCtx: MyContext) => {
      const text = textCtx.message?.text;
      if (text?.startsWith('Token-')) {
        const tokenData = await checkToken(text);
        if (tokenData && !tokenData.used) {
          await grantAccess(textCtx.from?.id.toString() || '', textCtx.from?.username || '', text);
          textCtx.reply('Access granted for 24 hours!');
          const subjects = await getSubjects();
          textCtx.reply('Select a subject:', paginate(subjects, 0, 'subject'));
          textCtx.session = { ...textCtx.session, state: 'subject' };
        } else {
          textCtx.reply('Invalid or already used token.');
        }
      }
    });

    bot.on('callback_query', async (queryCtx: MyContext) => {
      const data = queryCtx.callbackQuery?.data;
      if (!data) return;

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
        const buttons = Object.keys(content).map(num => 
          [Markup.button.callback(`Lecture ${num}`, `lecture_${subject}_${chapter}_${contentType}_${num}`)]
        );
        queryCtx.reply('Available lectures:', Markup.inlineKeyboard(buttons));
      } else if (data.startsWith('lecture_')) {
        const [_, subject, chapter, contentType, lectureNum] = data.split('_');
        const messageId = (await getContent(subject, chapter, contentType))[lectureNum];
        queryCtx.telegram.forwardMessage(
          queryCtx.chat?.id!,
          '-1001234567890', // Replace with actual group chat ID
          parseInt(messageId)
        );
      }
    });
  };
}
