import { Markup } from 'telegraf';

export function paginate(items: string[], page: number, prefix: string, itemsPerPage: number = 5) {
  const totalPages = Math.ceil(items.length / itemsPerPage);
  const start = page * itemsPerPage;
  const end = start + itemsPerPage;
  const pageItems = items.slice(start, end);

  const buttons = pageItems.map(item => [Markup.button.callback(item, `${prefix}_${item}`)]);
  
  const navButtons = [];
  if (page > 0) {
    navButtons.push(Markup.button.callback('Previous', `paginate_${prefix}_prev_${page - 1}`));
  }
  if (page < totalPages - 1) {
    navButtons.push(Markup.button.callback('Next', `paginate_${prefix}_next_${page + 1}`));
  }
  if (prefix !== 'admin_subject' && prefix !== 'user_subject') {
    navButtons.push(Markup.button.callback('Back', 'back'));
  }

  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }

  return {
    reply_markup: Markup.inlineKeyboard(buttons),
    totalPages,
    currentPage: page,
    prefix,
    itemsPerPage
  };
}
