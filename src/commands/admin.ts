import { Context, Markup } from 'telegraf';
import { getSubjects, saveContent } from '../utils/firebase';
import { paginate } from '../utils/pagination';

export function admin() {
  return async (ctx: Context) => {
    const subjects = ['Zoology', 'Botany', 'Physics', 'Organic Chemistry', 'Inorganic Chemistry', 'Physical Chemistry'];
    
    // Handle subject selection
    ctx.reply('Select a subject:', paginate(subjects, 0, 'subject')).then(msg => {
      ctx.session = { ...ctx.session, state: 'subject', messageId: msg.message_id };
    });

    // Handle callback queries
    bot.on('callback_query', async (queryCtx) => {
      const data = queryCtx.callbackQuery?.data;
      if (!data) return;

      if (data.startsWith('subject_')) {
        const subject = data.split('_')[1];
        const chapters = await getChapters(subject); // Assume this fetches chapters from Firebase
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

    // Handle message ID input
    bot.on('text', async (textCtx) => {
      if (textCtx.session?.state?.startsWith('message_')) {
        const [_, subject, chapter, contentType] = textCtx.session.state.split('_');
        const messageIds = textCtx.message?.text?.split(';').reduce((acc, pair) => {
          const [num, id] = pair.split(',');
          acc[num] = id;
          return acc;
        }, {} as Record<string, string>);
        
        await saveContent(subject, chapter, contentType, messageIds);
        textCtx.reply('Content saved successfully!');
        textCtx.session = { ...textCtx.session, state: null };
      }
    });
  };
}

async function getChapters(subject: string): Promise<string[]> {
  // This should fetch chapters from Firebase based on subject
  // Example for Zoology
  if (subject === 'Zoology') {
    return ['Biomolecules', 'Cell Structure', 'Animal Kingdom', 'Structural Organisation', 
            'Human Physiology', 'Evolution', 'Genetics'];
  }
  return []; // Add other subjects as needed
}
