import { Context, Markup, Telegraf } from 'telegraf';
import { getSubjects, saveContent } from '../utils/firebase';
import { paginate } from '../utils/pagination';

interface MyContext extends Context {
  session: {
    state?: string;
    messageId?: number;
  };
}

const ALLOWED_ADMIN_IDS = ['6930703214', '6930903213'];

// Local function to get subjects (hardcoded, not from Firebase)
const getLocalSubjects = async (): Promise<string[]> => {
  console.log('getLocalSubjects called'); // Debug log
  return ['Zoology', 'Botany', 'Physics', 'Organic Chemistry', 'Inorganic Chemistry', 'Physical Chemistry'];
};

// Local function to get chapters (hardcoded, not from Firebase)
async function getLocalChapters(subject: string): Promise<string[]> {
  console.log(`getLocalChapters called for subject: ${subject}`); // Debug log
  switch (subject) {
    case 'Zoology':
      return ['Biomolecules', 'Cell Structure', 'Animal Kingdom', 'Structural Organisation', 
              'Human Physiology', 'Evolution', 'Genetics'];
    case 'Botany':
      return ['Plant Kingdom', 'Morphology of Flowering Plants', 'Anatomy of Flowering Plants', 
              'Plant Physiology', 'Reproduction in Plants', 'Genetics and Evolution', 'Biotechnology'];
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
      return ['Some Basic Concepts', 'Atomic Structure', 'Chemical Kinetics', 'Thermodynamics', 
              'Equilibrium', 'Electrochemistry', 'States of Matter', 'Solutions'];
    default:
      console.warn(`No chapters defined for subject: ${subject}`);
      return [];
  }
}

export function admin(bot: Telegraf<MyContext>) {
  return async (ctx: MyContext) => {
    const userId = ctx.from?.id.toString();
    if (!userId || !ALLOWED_ADMIN_IDS.includes(userId)) {
      ctx.reply('You are not authorized to use this command.');
      return;
    }

    const commandText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const args = commandText.split(' ').slice(1).join(' ').split('&').map(item => item.trim());

    if (args.length === 3) {
      // Handle direct command like /admin Botany & Living World & DPP
      const [subject, chapter, contentType] = args;
      const validSubjects = await getLocalSubjects();
      const validChapters = await getLocalChapters(subject);
      const validContentTypes = ['DPP', 'Notes', 'Lectures'];

      if (!validSubjects.includes(subject)) {
        ctx.reply(`Invalid subject: ${subject}. Please select a valid subject.`);
        return;
      }
      if (!validChapters.includes(chapter)) {
        ctx.reply(`Invalid chapter: ${chapter} for subject ${subject}. Please select a valid chapter.`);
        return;
      }
      if (!validContentTypes.includes(contentType)) {
        ctx.reply(`Invalid content type: ${contentType}. Please use DPP, Notes, or Lectures.`);
        return;
      }

      try {
        const msg = await ctx.reply('Please send the message IDs in the format: x,y (e.g., 1,12345;2,67890) where x is the DPP/lecture number and y is the message ID.');
        ctx.session = { ...ctx.session, state: `message_${subject}_${chapter}_${contentType}`, messageId: msg.message_id };
      } catch (error) {
        console.error('Error sending message ID prompt:', error);
        ctx.reply('Error: Failed to process command. Please try again.');
      }
    } else {
      // Show subject selection as fallback
      const subjects = await getLocalSubjects();
      const pagination = paginate(subjects, 0, 'admin_subject');
      try {
        const msg = await ctx.reply('Select a subject:', pagination.reply_markup);
        ctx.session = { ...ctx.session, state: 'admin_subject', messageId: msg.message_id };
      } catch (error) {
        console.error('Error displaying subjects:', error);
        ctx.reply('Error: Failed to display subjects. Please try again.');
      }
    }

    // Register callback query handler
    bot.on('callback_query', async (queryCtx: MyContext) => {
      const callbackQuery = queryCtx.callbackQuery;
      if (!callbackQuery || !('data' in callbackQuery)) {
        console.warn('Invalid callback query received');
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
          if (prefix === 'subject') {
            items = await getLocalSubjects();
          } else if (prefix.startsWith('chapter_')) {
            const subject = prefix.split('_')[1];
            items = await getLocalChapters(subject);
          } else {
            queryCtx.reply('Error: Invalid pagination context.');
            return;
          }

          const pagination = paginate(items, page, `admin_${prefix}`);
          if (pagination.totalPages <= page || page < 0) {
            queryCtx.reply('Error: Page out of bounds.');
            return;
          }

          const messageText = prefix === 'subject' ? 'Select a subject:' : 'Select a chapter:';
          try {
            await queryCtx.telegram.editMessageText(
              queryCtx.chat?.id!,
              queryCtx.session?.messageId!,
              undefined,
              messageText,
              pagination.reply_markup
            );
          } catch (editError) {
            console.warn('Failed to edit message, sending new one:', editError);
            const msg = await queryCtx.reply(messageText, pagination.reply_markup);
            queryCtx.session = { ...queryCtx.session, messageId: msg.message_id };
          }
          queryCtx.session = { ...queryCtx.session, state: `admin_${prefix}` };
        } else if (data.startsWith('admin_subject_')) {
          const subject = data.split('_')[2];
          console.log(`Processing admin subject selection: ${subject}`);
          const chapters = await getLocalChapters(subject);
          if (chapters.length === 0) {
            queryCtx.reply('No chapters available for this subject.');
            return;
          }
          const pagination = paginate(chapters, 0, `admin_chapter_${subject}`);
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
            const msg = await queryCtx.reply('Select a chapter:', pagination.reply_markup);
            queryCtx.session = { ...queryCtx.session, messageId: msg.message_id };
          }
          queryCtx.session = { ...queryCtx.session, state: `admin_chapter_${subject}` };
        } else if (data.startsWith('admin_chapter_')) {
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
            const msg = await queryCtx.reply('Select content type:', Markup.inlineKeyboard(buttons));
            queryCtx.session = { ...queryCtx.session, messageId: msg.message_id };
          }
          queryCtx.session = { ...queryCtx.session, state: `content_${subject}_${chapter}` };
        } else if (data === 'back') {
          if (queryCtx.session?.state?.startsWith('content_')) {
            const subject = queryCtx.session.state.split('_')[1];
            const chapters = await getLocalChapters(subject);
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
          } else if (queryCtx.session?.state?.startsWith('admin_chapter_')) {
            const subjects = await getLocalSubjects();
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
          }
        } else if (data.startsWith('content_')) {
          const [_, subject, chapter, contentType] = data.split('_');
          try {
            const msg = await queryCtx.reply('Please send the message IDs in the format: x,y (e.g., 1,12345;2,67890) where x is the DPP/lecture number and y is the message ID.');
            queryCtx.session = { ...queryCtx.session, state: `message_${subject}_${chapter}_${contentType}`, messageId: msg.message_id };
          } catch (editError) {
            console.warn('Failed to send message ID prompt:', editError);
            queryCtx.reply('Error: Failed to process content type selection. Please try again.');
          }
        }
      } catch (error) {
        console.error('Error in callback handler:', error);
        queryCtx.reply('Error: Something went wrong. Please try again.');
      } finally {
        await queryCtx.answerCbQuery();
      }
    });

    // Register text handler
    bot.on('text', async (textCtx: MyContext) => {
      if (textCtx.session?.state?.startsWith('message_') && textCtx.message && 'text' in textCtx.message && typeof textCtx.message.text === 'string') {
        const [_, subject, chapter, contentType] = textCtx.session.state.split('_');
        try {
          const messageIds = textCtx.message.text.split(';').reduce((acc: Record<string, string>, pair: string) => {
            const [num, messageId] = pair.trim().split(',');
            if (!messageId || isNaN(parseInt(messageId))) {
              throw new Error('Invalid message ID format. Use x,y (e.g., 1,12345) where x is the DPP/lecture number and y is the message ID.');
            }
            acc[num] = messageId;
            return acc;
          }, {});
          
          await saveContent(subject, chapter, contentType, messageIds);
          textCtx.reply('Content saved successfully!');
          textCtx.session = { ...textCtx.session, state: undefined };
          
          // Return to subject selection
          const subjects = await getLocalSubjects();
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
            console.warn('Failed to edit message after saving content, sending new one:', editError);
            const msg = await textCtx.reply('Select a subject:', pagination.reply_markup);
            textCtx.session = { ...textCtx.session, state: 'admin_subject', messageId: msg.message_id };
          }
        } catch (error) {
          textCtx.reply(`Error saving content: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`);
        }
      }
    });
  };
}
