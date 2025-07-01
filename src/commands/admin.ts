import { Context, Markup, Telegraf } from 'telegraf';
import { getSubjects, getChapters, saveContent } from '../utils/firebase';
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

const SUBJECT_CHAPTERS = {
  'Zoology': ['Biomolecules', 'Cell Structure', 'Animal Kingdom', 'Structural Organisation', 'Human Physiology', 'Evolution', 'Genetics'],
  'Botany': ['Plant Kingdom', 'Morphology of Flowering Plants', 'Anatomy of Flowering Plants', 'Plant Physiology', 'Reproduction in Plants', 'Genetics and Evolution', 'Biotechnology'],
  'Physics': ['Mathematical Tools', 'Units and Measurements', 'Vectors', 'Optics', 'Modern Physics', 'Waves and Sound', 'Kinematics'],
  'Organic Chemistry': ['Hydrocarbons', 'Alcohols and Phenols', 'Aldehydes and Ketones', 'Carboxylic Acids', 'Amines', 'Biomolecules', 'Polymers'],
  'Inorganic Chemistry': ['Periodic Table', 'Chemical Bonding', 'Coordination Compounds', 'Metallurgy', 'P-Block Elements', 'D-Block Elements', 'S-Block Elements'],
  'Physical Chemistry': ['Some Basic Concepts', 'Atomic Structure', 'Chemical Kinetics', 'Thermodynamics', 'Equilibrium', 'Electrochemistry', 'States of Matter', 'Solutions']
};

export function admin(bot: Telegraf<MyContext>) {
  bot.command('admin', async (ctx: MyContext) => {
    const userId = ctx.from?.id.toString();
    if (!userId || !ADMIN_IDS.includes(userId)) {
      ctx.reply('Access denied: You are not an admin.');
      return;
    }

    const subjects = Object.keys(SUBJECT_CHAPTERS);
    const pagination = paginate(subjects, 0, 'admin_subject');
    ctx.reply('Select a subject:', pagination.reply_markup).then(msg => {
      ctx.session = { ...ctx.session, state: 'admin_subject', messageId: msg.message_id };
    });
  });

  bot.on('text', async (ctx: MyContext) => {
    const userId = ctx.from?.id.toString();
    if (!userId || !ADMIN_IDS.includes(userId) || !ctx.session?.state?.startsWith('admin_awaiting_ids_')) {
      return;
    }

    const [, , subject, chapter, contentType] = ctx.session.state.split('_');
    const input = ctx.message?.text?.trim();
    if (!input) {
      ctx.reply('Please provide message IDs in the format: 1,123;2,124;x,y');
      return;
    }

    try {
      const messageIds: Record<string, string> = {};
      const pairs = input.split(';').map(pair => pair.trim());
      for (const pair of pairs) {
        const [num, id] = pair.split(',').map(s => s.trim());
        if (!num || !id || isNaN(parseInt(num)) || isNaN(parseInt(id))) {
          ctx.reply(`Invalid format in pair "${pair}". Use: number,messageId (e.g., 1,123)`);
          return;
        }
        messageIds[num] = id;
      }

      await saveContent(subject, chapter, contentType, messageIds);
      ctx.reply(`Successfully saved ${contentType} for ${subject}/${chapter}.`);
      ctx.session = { ...ctx.session, state: undefined, subject: undefined, chapter: undefined, contentType: undefined };
    } catch (error) {
      console.error('Error saving content:', error);
      ctx.reply('Error saving content. Please try again.');
    }
  });

  bot.on('callback_query', async (ctx: MyContext) => {
    const userId = ctx.from?.id.toString();
    if (!userId || !ADMIN_IDS.includes(userId)) {
      ctx.reply('Access denied: You are not an admin.');
      await ctx.answerCbQuery();
      return;
    }

    const callbackQuery = ctx.callbackQuery;
    if (!callbackQuery || !('data' in callbackQuery)) {
      ctx.reply('Error: Invalid callback query.');
      await ctx.answerCbQuery();
      return;
    }

    const data = callbackQuery.data;
    try {
      if (data === 'back') {
        const { state, subject, chapter } = ctx.session || {};
        if (state?.startsWith('admin_awaiting_ids_')) {
          const [, , selectedSubject, selectedChapter] = state.split('_');
          const contentTypes = ['DPP', 'Notes', 'Lectures'];
          const buttons = contentTypes.map(type => [Markup.button.callback(type, `admin_content_${selectedSubject}_${selectedChapter}_${type}`)]);
          buttons.push([Markup.button.callback('Back', 'back')]);
          await ctx.telegram.editMessageText(
            ctx.chat?.id!,
            ctx.session?.messageId!,
            undefined,
            'Select content type:',
            Markup.inlineKeyboard(buttons)
          );
          ctx.session = { ...ctx.session, state: `admin_content_${selectedSubject}_${selectedChapter}` };
        } else if (state?.startsWith('admin_content_')) {
          const [, , selectedSubject] = state.split('_');
          const chapters = SUBJECT_CHAPTERS[selectedSubject] || await getChapters(selectedSubject);
          const pagination = paginate(chapters, 0, `admin_chapter_${selectedSubject}`);
          await ctx.telegram.editMessageText(
            ctx.chat?.id!,
            ctx.session?.messageId!,
            undefined,
            'Select a chapter:',
            pagination.reply_markup
          );
          ctx.session = { ...ctx.session, state: `admin_chapter_${selectedSubject}`, chapter: undefined, contentType: undefined };
        } else if (state?.startsWith('admin_chapter_')) {
          const subjects = Object.keys(SUBJECT_CHAPTERS);
          const pagination = paginate(subjects, 0, 'admin_subject');
          await ctx.telegram.editMessageText(
            ctx.chat?.id!,
            ctx.session?.messageId!,
            undefined,
            'Select a subject:',
            pagination.reply_markup
          );
          ctx.session = { ...ctx.session, state: 'admin_subject', subject: undefined, chapter: undefined, contentType: undefined };
        }
      } else if (data.startsWith('paginate_admin_')) {
        const [_, __, prefix, action, pageStr] = data.split('_');
        const page = parseInt(pageStr);
        if (isNaN(page)) {
          ctx.reply('Error: Invalid page number.');
          await ctx.answerCbQuery();
          return;
        }

        let items: string[];
        let replyText: string;
        if (prefix === 'subject') {
          items = Object.keys(SUBJECT_CHAPTERS);
          replyText = 'Select a subject:';
        } else if (prefix.startsWith('chapter_')) {
          const subject = prefix.split('_')[1];
          items = SUBJECT_CHAPTERS[subject] || await getChapters(subject);
          replyText = 'Select a chapter:';
        } else {
          ctx.reply('Error: Invalid pagination context.');
          await ctx.answerCbQuery();
          return;
        }

        const pagination = paginate(items, page, `admin_${prefix}`);
        if (pagination.totalPages <= page || page < 0) {
          ctx.reply('Error: Page out of bounds.');
          await ctx.answerCbQuery();
          return;
        }

        try {
          await ctx.telegram.editMessageText(
            ctx.chat?.id!,
            ctx.session?.messageId!,
            undefined,
            replyText,
            pagination.reply_markup
          );
        } catch (editError) {
          console.warn('Failed to edit message, sending new one:', editError);
          ctx.reply(replyText, pagination.reply_markup).then(msg => {
            ctx.session = { ...ctx.session, messageId: msg.message_id };
          });
        }
        ctx.session = { ...ctx.session, state: `admin_${prefix}` };
      } else if (data.startsWith('admin_subject_')) {
        const subject = data.split('_')[2];
        const chapters = SUBJECT_CHAPTERS[subject] || await getChapters(subject);
        const pagination = paginate(chapters, 0, `admin_chapter_${subject}`);
        try {
          await ctx.telegram.editMessageText(
            ctx.chat?.id!,
            ctx.session?.messageId!,
            undefined,
            'Select a chapter:',
            pagination.reply_markup
          );
        } catch (editError) {
          console.warn('Failed to edit message, sending new one:', editError);
          ctx.reply('Select a chapter:', pagination.reply_markup).then(msg => {
            ctx.session = { ...ctx.session, messageId: msg.message_id };
          });
        }
        ctx.session = { ...ctx.session, state: `admin_chapter_${subject}`, subject: subject };
      } else if (data.startsWith('admin_chapter_')) {
        const [_, __, subject, chapter] = data.split('_');
        const contentTypes = ['DPP', 'Notes', 'Lectures'];
        const buttons = contentTypes.map(type => [Markup.button.callback(type, `admin_content_${subject}_${chapter}_${type}`)]);
        buttons.push([Markup.button.callback('Back', 'back')]);
        try {
          await ctx.telegram.editMessageText(
            ctx.chat?.id!,
            ctx.session?.messageId!,
            undefined,
            'Select content type:',
            Markup.inlineKeyboard(buttons)
          );
        } catch (editError) {
          console.warn('Failed to edit message, sending new one:', editError);
          ctx.reply('Select content type:', Markup.inlineKeyboard(buttons)).then(msg => {
            ctx.session = { ...ctx.session, messageId: msg.message_id };
          });
        }
        ctx.session = { ...ctx.session, state: `admin_content_${subject}_${chapter}`, chapter };
      } else if (data.startsWith('admin_content_')) {
        const [_, subject, chapter, contentType] = data.split('_');
        try {
          await ctx.telegram.editMessageText(
            ctx.chat?.id!,
            ctx.session?.messageId!,
            undefined,
            `Please send message IDs for ${subject}/${chapter}/${contentType} in the format: 1,123;2,124;x,y`,
            Markup.inlineKeyboard([[Markup.button.callback('Back', 'back')]])
          );
        } catch (editError) {
          console.warn('Failed to edit message, sending new one:', editError);
          ctx.reply(`Please send message IDs for ${subject}/${chapter}/${contentType} in the format: 1,123;2,124;x,y`, Markup.inlineKeyboard([[Markup.button.callback('Back', 'back')]])).then(msg => {
            ctx.session = { ...ctx.session, messageId: msg.message_id };
          });
        }
        ctx.session = { ...ctx.session, state: `admin_awaiting_ids_${subject}_${chapter}_${contentType}`, subject, chapter, contentType };
      }
    } catch (error) {
      console.error('Error in admin callback handler:', error);
      ctx.reply('Error: Something went wrong. Please try again.');
    } finally {
      await ctx.answerCbQuery();
    }
  });
}
