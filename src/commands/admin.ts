import { Context, Markup, Telegraf } from 'telegraf';
import { getSubjects, saveContent, getChapters } from '../utils/firebase';
import { paginate } from '../utils/pagination';
import { getAuth, signInAnonymously } from 'firebase/auth';

interface MyContext extends Context {
  session: {
    state?: string;
    messageId?: number;
  };
}

const ALLOWED_ADMIN_IDS = ['6930703214', '6930903213'];

export function admin(bot: Telegraf<MyContext>) {
  return async (ctx: MyContext) => {
    const userId = ctx.from?.id.toString();
    if (!userId || !ALLOWED_ADMIN_IDS.includes(userId)) {
      ctx.reply('You are not authorized to use this command.');
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
        const chapters = await getAdminChapters(subject); // Use renamed function
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
        queryCtx.reply('Please send the message IDs in the format: 1,2/12345;2,2/67890 (topic_id/message_id)');
        queryCtx.session = { ...queryCtx.session, state: `message_${subject}_${chapter}_${contentType}` };
      }
    });

    bot.on('text', async (textCtx: MyContext) => {
      if (textCtx.session?.state?.startsWith('message_') && textCtx.message && 'text' in textCtx.message && typeof textCtx.message.text === 'string') {
        const [_, subject, chapter, contentType] = textCtx.session.state.split('_');
        try {
          const messageIds = textCtx.message.text.split(';').reduce((acc: Record<string, string>, pair: string) => {
            const [num, id] = pair.split(',');
            if (!id.includes('/')) {
              throw new Error('Invalid message ID format. Use topic_id/message_id (e.g., 2/12345).');
            }
            acc[num] = id;
            return acc;
          }, {});
          
          await saveContent(subject, chapter, contentType, messageIds);
          textCtx.reply('Content saved successfully!');
          textCtx.session = { ...textCtx.session, state: undefined };
        } catch (error) {
          textCtx.reply(`Error saving content: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`);
        }
      }
    });
  };
}

async function getAdminChapters(subject: string): Promise<string[]> {
  switch (subject) {
    case 'Zoology':
      return ['Biomolecules', 'Cell Structure', 'Animal Kingdom', 'Structural Organisation', 
              'Human Physiology', 'Evolution', 'Genetics'];
    case 'Physics':
      return ['Mathematical Tools', 'Units and Measurements', 'Vectors', 'Optics', 
              'Modern Physics', 'Waves and Sound', 'Kinematics'];
    case 'Organic Chemistry':
      return ['Hydrocarbons', 'Alcohols and Phenols', 'Aldehydes and Ketones', 
              'Carboxylic Acids', 'Amines', 'Biomolecules', 'Polymers'];
    case 'Inorganic Chemistry':
      return ['Periodic Table', 'Chemical Bonding', 'Coordination Compounds', 
              'Metallurgy', 'P-Block Elements', 'D-Block Elements', 'S-Block Elements'];
    case 'Physical Chemistry':
      return ['Atomic Structure', 'Chemical Kinetics', 'Thermodynamics', 
              'Equilibrium', 'Electrochemistry', 'States of Matter', 'Solutions'];
    default:
      return [];
  }
}
