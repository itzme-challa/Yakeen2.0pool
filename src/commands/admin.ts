import { Context, Markup, Telegraf } from 'telegraf';
import { getSubjects, saveContent } from '../utils/firebase';
import { paginate } from '../utils/pagination';

interface MyContext extends Context {
  session: {
    state?: string;
    messageId?: number;
  };
}

export function admin(bot: Telegraf<MyContext>) {
  return async (ctx: MyContext) => {
    const subjects = ['Zoology', 'Botany', 'Physics', 'Organic Chemistry', 'Inorganic Chemistry', 'Physical Chemistry'];
    
    ctx.reply('Select a subject:', paginate(subjects, 0, 'subject')).then(msg => {
      ctx.session = { ...ctx.session, state: 'subject', messageId: msg.message_id };
    });

    bot.on('callback_query', async (queryCtx: MyContext) => {
      const callbackQuery = queryCtx.callbackQuery;
      if (!callbackQuery || !('data' in callbackQuery)) return;

      const data = callbackQuery.data;
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
        queryCtx.reply('Please send the message IDs in the format: 1,12345;2,67890;3,54321');
        queryCtx.session = { ...queryCtx.session, state: `message_${subject}_${chapter}_${contentType}` };
      }
    });

    bot.on('text', async (textCtx: MyContext) => {
      if (textCtx.session?.state?.startsWith('message_') && textCtx.message && 'text' in textCtx.message && typeof textCtx.message.text === 'string') {
        const [_, subject, chapter, contentType] = textCtx.session.state.split('_');
        const messageIds = textCtx.message.text.split(';').reduce((acc: Record<string, string>, pair: string) => {
          const [num, id] = pair.split(',');
          acc[num] = id;
          return acc;
        }, {});
        
        await saveContent(subject, chapter, contentType, messageIds);
        textCtx.reply('Content saved successfully!');
        textCtx.session = { ...textCtx.session, state: undefined };
      }
    });
  };
}

async function getChapters(subject: string): Promise<string[]> {
  if (subject === 'Zoology') {
    return ['Biomolecules', 'Cell Structure', 'Animal Kingdom', 'Structural Organisation', 
            'Human Physiology', 'Evolution', 'Genetics'];
  }
  return [];
}
