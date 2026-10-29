/**
 * THE HELP FILMS, as a script: for each film in `HELP_VIDEOS`, who it signs
 * in as, where it starts, and what is said over what is done.
 *
 * Each step's `say` is one line of narration, rendered by `tts.py`; its `do`
 * is what happens on screen while it is said, through the helpers
 * `record.mjs` hands it (`tap`, `type`, `highlight`, …), which draw the touch
 * or the pointer so a viewer can follow. Every film is recorded in a freshly
 * built guide world (`world.mjs`), so what one film changes is not in the
 * next. A step with `cut` is in that cut alone: what a phone and a computer
 * do differently — one column at a time, a press and hold, a drag.
 *
 * THE NARRATION IS A COLLEAGUE TALKING YOU THROUGH THE SCREEN: whole
 * sentences, "you", contractions, and the reason when it helps. Never a list
 * of labels read out ("Add card. Type a title. Tap Add."), which is what the
 * first films of the sister app sounded like, and why they read as stiff.
 * Read a new line aloud before rendering it.
 */
/** A small PDF to attach: a supplier's quote. */
const QUOTE = {
  name: 'IMG_20261026_114502.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  ),
};

export const TUTORIALS = [
  // ---------------------------------------------------------------- everyone
  {
    id: 'signing-in',
    as: null,
    start: '',
    // Omar as a brand-new account: waiting for approval, and not yet agreed to the rules.
    before: (w) => w.setAccess(w.uids.omar, { role: 'member', status: 'pending', rulesAccepted: false }),
    steps: [
      { say: "Welcome to Sabeel Kanban! Let's get you signed in.", do: (t) => t.wait(600) },
      {
        say: "You sign in with Google, using your oursabeel.com account. That's the only kind of account that works here, so there's no extra password to remember.",
        do: (t) => t.highlight(t.btn('Sign in with Google')),
      },
      {
        say: "You'll see Sign in with email just underneath. You can ignore that one. Your staff account always uses Google.",
        do: (t) => t.highlight(t.btn('Sign in with email')),
      },
      {
        say: "If you're using the phone app, sign in on the website once first. That sets your account up, and from then on the app works just fine.",
        do: (t) => t.wait(400),
      },
      {
        say: "So let's tap Sign in with Google.",
        do: async (t) => {
          await t.fakeTap(t.btn('Sign in with Google'));
          await t.devSignIn('omar');
          await t.waitFor(t.text('Waiting for approval'), 40000);
        },
      },
      {
        say: "The very first time, you'll land here. Your account is waiting for an admin to approve it. There's nothing you need to do, so just leave this open.",
        do: (t) => t.highlight(t.text('Waiting for approval')),
      },
      {
        say: "As soon as they let you in, the page moves on by itself. No need to refresh.",
        do: async (t) => {
          await t.wait(2500);
          await t.world.setAccess(t.world.uids.omar, { role: 'member', status: 'active' });
          await t.waitFor(t.text('Before you continue'), 30000);
        },
      },
      {
        say: "Next come the institute's rules. They're worth a quick read, and you'll only see them this once.",
        do: async (t) => {
          await t.scroll(260);
          await t.scroll(-260);
        },
      },
      {
        say: "When you're ready, tap I agree.",
        do: (t) => t.tap(t.btn('I agree')),
      },
      {
        say: "And you're in! These are your boards, and you're all set to get to work.",
        do: (t) => t.waitFor(t.text('Fundraising 2026'), 30000),
      },
    ],
  },
  {
    id: 'getting-around',
    as: 'omar',
    start: '',
    steps: [
      { say: "Let's take a quick look around, so you know where everything is.", do: (t) => t.wait(600) },
      {
        say: "On a phone, the menu runs along the bottom of the screen. It's there on every list, and steps aside when you open a board or a card.",
        cut: 'phone',
        do: (t) => t.highlight(t.btn('Boards')),
      },
      {
        say: "On a computer, the menu runs down the left side, and it stays put wherever you are.",
        cut: 'computer',
        do: (t) => t.highlight(t.btn('Boards')),
      },
      {
        say: "Boards is home. It lists every board you've been added to.",
        do: (t) => t.highlight(t.text('Fundraising 2026')),
      },
      {
        say: "Tap the star next to a board you use a lot, and it stays at the top of the list.",
        do: (t) => t.tap(t.btn('Star Weekend School')),
      },
      {
        say: "My Work gathers every card that's assigned to you, from all your boards, so you never have to go hunting.",
        do: async (t) => {
          await t.tap(t.btn('My Work'));
          await t.waitFor(t.text('My work'));
        },
      },
      {
        say: 'Search finds any card on your boards by the words in it.',
        do: async (t) => {
          await t.tap(t.btn('Search'));
          await t.waitFor(t.placeholder('Search cards across your boards'));
        },
      },
      {
        say: "Alerts is where you'll find anything you've been told about, like a card being assigned to you, or someone mentioning you in a comment.",
        do: async (t) => {
          await t.tap(t.btn(/^Alerts/));
          await t.waitFor(t.text('Notifications'));
        },
      },
      {
        say: 'And More has everything else: reporting a problem, signing out, and Help, which is where these films live.',
        do: async (t) => {
          await t.tap(t.btn('More'));
          await t.highlight(t.btn('Help'));
        },
      },
      {
        say: "If you're an admin, you'll find People and Stats in here too. Tap Cancel, and you're back where you were.",
        do: async (t) => {
          await t.wait(2200);
          await t.tap(t.btn('Cancel'));
        },
      },
    ],
  },
  {
    id: 'board',
    as: 'omar',
    start: '',
    steps: [
      {
        say: "Let's open a board. Just tap on its name.",
        do: async (t) => {
          await t.tap(t.text('Fundraising 2026'));
          await t.waitFor(t.card('Book the venue'));
        },
      },
      {
        say: "On a phone, you see one column at a time. The top tells you which column you're looking at, and how many there are.",
        cut: 'phone',
        do: (t) => t.highlight(t.text('1 of 4')),
      },
      {
        say: 'Tap the arrows on either side to move between columns, or just swipe across.',
        cut: 'phone',
        do: async (t) => {
          await t.tap(t.btn('Next column'));
          await t.wait(700);
          await t.tap(t.btn('Next column'));
          await t.wait(700);
          await t.tap(t.btn('Previous column'));
          await t.tap(t.btn('Previous column'));
        },
      },
      {
        say: 'On a computer, you see every column side by side, from the first all the way across to Done.',
        cut: 'computer',
        do: (t) => t.highlight(t.id('board-columns')),
      },
      {
        say: "Each card shows the important bits at a glance: who it's assigned to, when it's due, how urgent it is, and its labels.",
        do: (t) => t.highlight(t.card('Confirm the caterer')),
      },
      {
        say: "Anything past its due date turns red, so it's easy to spot.",
        do: (t) => t.highlight(t.card('Book the venue')),
      },
      {
        say: 'To add a card, tap Add card at the bottom of the column.',
        do: (t) => t.tap(t.btn('+ Add card')),
      },
      {
        say: "Give it a short title, and press Enter. That's all there is to it.",
        do: async (t) => {
          await t.type(t.placeholder('Card title'), 'Invite local businesses');
          await t.press('Enter');
        },
      },
      {
        say: 'And there it is. Tap any card to open it and see everything about it.',
        do: (t) => t.highlight(t.card('Invite local businesses')),
      },
    ],
  },
  {
    id: 'card',
    as: 'omar',
    start: (w) => w.board('fundraising'),
    steps: [
      {
        say: 'Tap a card to open it. Everything about the card is in one place.',
        do: async (t) => {
          await t.tap(t.card('Confirm the caterer'));
          await t.waitFor(t.btn('Share card'));
        },
      },
      {
        say: "The title's at the top. If you need to change it, tap the pencil.",
        do: (t) => t.highlight(t.btn('Edit title')),
      },
      {
        say: "Just below, you can see which column the card is in. Pick another one here, and the card moves without you going back to the board.",
        do: (t) => t.highlight(t.label('Column')),
      },
      {
        say: 'The description holds the details. Tap the pencil next to it to start writing.',
        do: (t) => t.tap(t.btn('Edit description')),
      },
      {
        say: 'Type away as normal. The buttons along the top let you add bold, italics, lists and links.',
        do: async (t) => {
          await t.type(t.editor(), 'Ask about a vegetarian option, and give them the final head count by Friday.');
          await t.highlight(t.btn('Bold'));
        },
      },
      { say: "When you're happy with it, tap Save.", do: (t) => t.tap(t.btn('Save')) },
      {
        say: 'You can set how urgent the card is, from low all the way up to urgent.',
        do: (t) => t.tap(t.btn('Priority urgent')),
      },
      {
        say: "Give it a due date, and if it runs late, it'll show up in red.",
        do: async (t) => {
          await t.highlight(t.label('Due date'));
          await t.fill(t.label('Due date'), t.inDays(2));
        },
      },
      {
        say: 'To hand the card to someone, tap the person icon next to Assignees, and pick their name.',
        do: async (t) => {
          await t.tap(t.btn(/^Assign someone/));
          await t.tap(t.btn('Assign Sara'));
          await t.tap(t.btn('Done'));
        },
      },
      {
        say: 'Labels work the same way. Tap one to add it, or the plus to make a new one.',
        do: async (t) => {
          await t.tap(t.btn('Label Donors'));
          await t.highlight(t.btn('New label'));
        },
      },
      {
        say: "Everything you change is saved right away, and everyone on the board sees it straight away too.",
        do: (t) => t.scroll(-400),
      },
    ],
  },
  {
    id: 'comments',
    as: 'omar',
    start: (w) => w.card('fundraising', 'letter'),
    steps: [
      {
        say: 'Every card has its own conversation. Scroll down to Comments to see what everyone has said.',
        do: (t) => t.scrollTo(t.text(/^Comments \(\d+\)$/)),
      },
      {
        say: "Sara's asked you a question here, so let's reply.",
        do: (t) => t.highlight(t.text(/could you add the figures/, false)),
      },
      {
        say: 'Tap the comment box and start typing.',
        do: (t) => t.type(t.id('comment-editor'), "Sure, I'll add them this afternoon. "),
      },
      {
        say: 'To bring someone else in, type the at sign. A list of everyone on the board pops up.',
        do: async (t) => {
          await t.typeFocused('@');
          await t.waitFor(t.id('mention-popover'));
        },
      },
      {
        say: "Pick a name, and they'll get a notification.",
        do: async (t) => {
          await t.tap(t.btn('Mention Faisal'));
          await t.typeFocused('could you check the totals?');
        },
      },
      { say: 'Then tap Comment to post it.', do: (t) => t.tap(t.btn('Comment')) },
      {
        say: 'You can always go back and edit your own comments with the pencil.',
        do: (t) => t.highlight(t.btn('Edit comment')),
      },
      {
        say: "If you'd like to hear about new comments on a card that isn't yours, tap the bell at the top to follow it. Tap it again whenever you want to stop.",
        do: async (t) => {
          await t.scroll(-2000);
          await t.tap(t.btn('Subscribe to comments'));
          await t.waitFor(t.btn('Unsubscribe from comments'));
        },
      },
    ],
  },
  {
    id: 'attachments',
    as: 'omar',
    start: (w) => w.card('fundraising', 'caterer'),
    steps: [
      {
        say: 'You can put files on a card, like a quote, a photo of a receipt, or a signed form.',
        do: (t) => t.scrollTo(t.btn('Attach a file')),
      },
      {
        say: 'Tap the paperclip next to Attachments, and choose your file. On a phone, you can also pick a photo, or take one right there.',
        do: (t) => t.chooseFile(t.btn('Attach a file'), QUOTE),
      },
      {
        say: "Before it uploads, you can give it a better name, so everyone knows what it is at a glance.",
        do: (t) => t.replace(t.placeholder('File name'), 'Caterer quote'),
      },
      {
        say: 'Then tap Upload.',
        do: async (t) => {
          await t.tap(t.btn('Upload'));
          await t.waitFor(t.btn(/^Open Caterer quote/), 30000);
        },
      },
      {
        say: 'Tap the file any time to open it.',
        do: (t) => t.highlight(t.btn(/^Open Caterer quote/)),
      },
      {
        say: "And the bin removes it. Anyone on the board can do that, so if the wrong file goes up, it's easy to fix.",
        do: (t) => t.highlight(t.btn(/^Remove Caterer quote/)),
      },
      {
        say: 'Each file can be up to ten megabytes, and a card can hold as many as you need.',
        do: (t) => t.wait(500),
      },
    ],
  },
  {
    id: 'subtasks',
    as: 'omar',
    start: (w) => w.card('fundraising', 'letter'),
    steps: [
      {
        say: "Some jobs are easier in smaller pieces. That's what subtasks are for.",
        do: (t) => t.scrollTo(t.label('New subtask title')),
      },
      {
        say: 'This card already has one. A subtask is a proper card of its own, with its own people, dates and comments.',
        do: (t) => t.highlight(t.btn('Open subtask Design the programme')),
      },
      {
        say: 'To add another, type a title here, and tap the plus.',
        do: async (t) => {
          await t.type(t.label('New subtask title'), 'Choose the paper for the letter');
          await t.tap(t.btn('Add subtask'));
          await t.waitFor(t.btn('Open subtask Choose the paper for the letter'));
        },
      },
      {
        say: "It's made in the same column as the card you're on.",
        do: (t) => t.highlight(t.btn('Open subtask Choose the paper for the letter')),
      },
      {
        say: 'If the card you want is already on the board, use the link button to attach it instead.',
        do: (t) => t.highlight(t.btn('Link an existing card')),
      },
      {
        say: 'Tap a subtask to jump straight to it. At the top, it shows which card it belongs to, so you can always find your way back.',
        do: async (t) => {
          await t.tap(t.btn('Open subtask Design the programme'));
          await t.highlight(t.btn(/^Open parent card/));
        },
      },
      {
        say: "And if you unlink a subtask, nothing's deleted. It just goes back to being an ordinary card.",
        do: (t) => t.highlight(t.btn('Unlink from parent card')),
      },
    ],
  },
  {
    id: 'moving',
    as: 'omar',
    start: (w) => w.board('fundraising'),
    steps: [
      { say: "Let's move a card along. There are a couple of ways to do it.", do: (t) => t.wait(600) },
      {
        say: 'On a computer, you can simply drag a card from one column to another.',
        cut: 'computer',
        do: async (t) => {
          await t.drag(t.card('Confirm the caterer'), t.id('column-cards-In Progress'));
          await t.wait(600);
        },
      },
      {
        say: 'You can also do it from inside the card. Open it up.',
        do: async (t) => {
          await t.tap(t.card(t.phone ? 'Confirm the caterer' : 'Book the venue'));
          await t.waitFor(t.btn('Share card'));
        },
      },
      {
        say: 'Then pick a new column from this list, and the card moves straight away.',
        do: async (t) => {
          await t.highlight(t.label('Column'));
          await t.select(t.label('Column'), 'In Progress');
        },
      },
      {
        say: 'Want to point someone to a card? Tap the share button at the top.',
        do: (t) => t.tap(t.btn('Share card')),
      },
      {
        say: 'On a phone, that brings up your usual share options, like WhatsApp or a text message. On a computer, it copies the link, ready to paste anywhere.',
        do: (t) => t.wait(400),
      },
      {
        say: "Whoever opens the link lands right on this card, as long as they're on the board.",
        do: (t) => t.wait(400),
      },
      {
        say: 'And to get back to the board, tap its name at the top of the card.',
        do: async (t) => {
          await t.tap(t.link(/^Open board Fundraising 2026/));
          await t.waitFor(t.card('Book the venue'));
        },
      },
    ],
  },
  {
    id: 'archiving',
    as: 'omar',
    start: (w) => w.board('fundraising'),
    steps: [
      {
        say: "When a card's done with but you'd like to keep it, archive it. It comes off the board, but nothing is lost.",
        do: (t) => t.wait(600),
      },
      {
        say: 'Open the card, scroll right to the bottom, and tap Archive card.',
        do: async (t) => {
          if (t.phone) await t.tap(t.btn('Next column'), { times: 3 });
          await t.tap(t.card('Pick the date'));
          await t.scrollTo(t.btn('Archive card'));
          await t.tap(t.btn('Archive card'));
          await t.waitFor(t.btn('Archived cards'));
        },
      },
      {
        say: 'On a computer, each card on the board also has its own Archive button.',
        cut: 'computer',
        do: (t) => t.highlight(t.btn('Archive Set the fundraising target')),
      },
      {
        say: "It's gone from the board. To find it again, tap the archive icon.",
        do: async (t) => {
          await t.tap(t.btn('Archived cards'));
          await t.waitFor(t.text('Archived cards'));
        },
      },
      {
        say: "Here's everything that's been archived on this board, with the most recent first.",
        do: (t) => t.highlight(t.text('Pick the date')),
      },
      {
        say: 'Tap restore, and it goes straight back onto the board.',
        do: (t) => t.tap(t.btn('Restore Pick the date to the board')),
      },
      {
        say: 'You can also find archived cards from Search, by turning on the Archived filter.',
        do: (t) => t.wait(400),
      },
      {
        say: "Only a board's owners can delete a card for good, and they're asked to make sure first, because that can't be undone.",
        do: (t) => t.wait(400),
      },
    ],
  },
  {
    id: 'bulk',
    as: 'omar',
    start: (w) => w.board('fundraising'),
    steps: [
      {
        say: 'To deal with several cards at once, press and hold one of them.',
        cut: 'phone',
        do: (t) => t.longPress(t.card('Order the printed programmes')),
      },
      {
        say: 'Then tap the others you want.',
        cut: 'phone',
        do: (t) => t.tap(t.card('Write the thank-you cards')),
      },
      {
        say: 'To deal with several cards at once, tick the box on each one you want.',
        cut: 'computer',
        do: async (t) => {
          await t.tap(t.checkbox('Select Order the printed programmes'));
          await t.tap(t.checkbox('Select Write the thank-you cards'));
        },
      },
      {
        say: 'Holding Shift picks a whole run of cards in one go.',
        cut: 'computer',
        do: (t) => t.wait(400),
      },
      {
        say: "A bar pops up showing how many you've picked, and what you can do with them.",
        do: (t) => t.highlight(t.text('2 selected')),
      },
      {
        say: 'You can move them to another column, assign them to someone, or archive them all together.',
        do: async (t) => {
          await t.highlight(t.btn('Move selected cards'));
          await t.highlight(t.btn('Assign selected cards'));
          await t.highlight(t.btn('Archive selected cards'));
        },
      },
      {
        say: "Let's send these to another board. Tap this button, then pick the board and the column you want.",
        do: async (t) => {
          await t.tap(t.btn('Copy or move to another board'));
          await t.select(t.label('Destination board'), 'Weekend School');
          await t.select(t.label('Destination column'), 'To Do');
        },
      },
      {
        say: 'Move takes the cards over just as they are, comments and all. Copy leaves these where they are, and makes fresh ones.',
        do: async (t) => {
          await t.highlight(t.btn('Move'));
          await t.highlight(t.btn('Copy'));
        },
      },
      {
        say: "We'll go with Move. And just like that, they're on the other board.",
        do: async (t) => {
          await t.tap(t.btn('Move'));
          await t.waitGone(t.card('Order the printed programmes'));
        },
      },
    ],
  },
  {
    id: 'my-work',
    as: 'omar',
    start: '',
    steps: [
      {
        say: "My Work is the quickest way to see what's on your plate.",
        do: async (t) => {
          await t.tap(t.btn('My Work'));
          await t.waitFor(t.card('Book the venue'));
        },
      },
      {
        say: 'It gathers every card assigned to you, from every board, so nothing slips through the cracks.',
        do: async (t) => {
          await t.scroll(500);
          await t.scroll(-500);
        },
      },
      {
        say: "They're grouped by when they're due: anything overdue first, then today, then the next seven days, and then everything later.",
        do: async (t) => {
          await t.highlight(t.text(/^Overdue/));
          await t.highlight(t.text(/^Today/));
          await t.highlight(t.text(/^Next 7 days/));
        },
      },
      {
        say: "Each card tells you which board it's on.",
        do: (t) => t.highlight(t.card('Book the venue')),
      },
      {
        say: "The filters at the top switch between cards assigned to you, and cards you're following.",
        do: (t) => t.highlight(t.btn(/^Subscribed/)),
      },
      {
        say: 'Tap any card to open it.',
        do: async (t) => {
          await t.tap(t.card('Book the venue'));
          await t.waitFor(t.btn('Share card'));
        },
      },
    ],
  },
  {
    id: 'search',
    as: 'omar',
    start: '',
    steps: [
      {
        say: 'Search looks through every card on every board you belong to.',
        do: async (t) => {
          await t.tap(t.btn('Search'));
          await t.waitFor(t.placeholder('Search cards across your boards'));
        },
      },
      {
        say: "Before you've typed a thing, it shows all your cards, newest first.",
        do: async (t) => {
          await t.scroll(400);
          await t.scroll(-400);
        },
      },
      {
        say: 'Start typing, and the list narrows down as you go.',
        do: (t) => t.type(t.placeholder('Search cards across your boards'), 'letter'),
      },
      {
        say: 'Up here are a couple of quick filters. Overdue shows only cards that are running late, and Archived finds cards that have been put away.',
        do: async (t) => {
          await t.replace(t.placeholder('Search cards across your boards'), '');
          await t.highlight(t.btn(/^Archived filter/));
          await t.tap(t.btn(/^Overdue filter/));
        },
      },
      {
        say: "For more, tap Filters. You can narrow things down by priority, board, label, or who a card's assigned to.",
        do: async (t) => {
          await t.tap(t.btn(/^Overdue filter/));
          await t.tap(t.btn('Filters'));
          await t.tap(t.btn(/^Board(:|$)/));
          await t.tap(t.btn('Filter to Fundraising 2026'));
        },
      },
      {
        say: 'Tap Done, and each filter shows up as a chip. Tap a chip to take that filter off.',
        do: async (t) => {
          await t.tap(t.btn('Done'));
          await t.highlight(t.btn(/^Remove the /));
        },
      },
      {
        say: "And you can change the order with Sort. Oldest first is handy for finding things nobody's touched in a while.",
        do: (t) => t.select(t.label('Sort'), 'Oldest first'),
      },
    ],
  },
  {
    id: 'notifications',
    as: 'omar',
    start: '',
    permission: 'default',
    steps: [
      {
        say: "Alerts is where you'll find everything you've been told about.",
        do: async (t) => {
          await t.tap(t.btn(/^Alerts/));
          await t.waitFor(t.btn(/Sara mentioned you on .Draft the donor letter/));
        },
      },
      {
        say: "You'll hear about it when someone gives you a card, or mentions you in a comment. Unread ones stand out, so you can see what's new.",
        do: (t) => t.highlight(t.btn(/Sara mentioned you on .Draft the donor letter/)),
      },
      {
        say: 'Tap one, and it takes you straight to the card.',
        do: async (t) => {
          await t.tap(t.btn(/Sara mentioned you on .Draft the donor letter/));
          await t.waitFor(t.btn('Share card'));
          await t.wait(900);
          await t.tap(t.btn('Back'));
        },
      },
      {
        say: 'The envelope marks an alert read or unread, so you can flag something to come back to. And the cross clears it away.',
        do: async (t) => {
          await t.highlight(t.btn(/^Mark (read|unread): /));
          await t.highlight(t.btn(/^Dismiss: /));
        },
      },
      {
        say: 'Up at the top, you can show just the unread ones, or mark the whole lot as read.',
        do: async (t) => {
          await t.highlight(t.btn('Show unread only'));
          await t.highlight(t.btn('Mark all read'));
        },
      },
      {
        say: 'The gear opens your notification settings.',
        do: (t) => t.tap(t.btn('Notification settings')),
      },
      {
        say: "To get notifications on this phone or computer, tap Enable notifications. You'll only need to do that once on each device.",
        do: (t) => t.highlight(t.btn('Enable notifications')),
      },
      {
        say: 'Below that, you choose what you hear about. Each kind has its own switch.',
        do: async (t) => {
          await t.scrollTo(t.text('What you are told about'));
          await t.highlight(t.switch('You are @mentioned'));
        },
      },
      {
        say: 'And if a board gets a bit noisy, you can mute it with its bell.',
        do: async (t) => {
          await t.scrollTo(t.btn('Mute Fundraising 2026'));
          await t.highlight(t.btn('Mute Fundraising 2026'));
        },
      },
    ],
  },
  {
    id: 'report',
    as: 'omar',
    start: '',
    steps: [
      {
        say: "If something on a board breaks the institute's rules, like a comment, a file, or the way someone's behaving, you can let the admins know.",
        do: (t) => t.wait(600),
      },
      {
        say: 'Open More, and tap Report a problem.',
        do: async (t) => {
          await t.tap(t.btn('More'));
          await t.tap(t.btn(/^Report a problem/));
        },
      },
      {
        say: "Tell them what's wrong in your own words, and which board, card or person it's about.",
        do: (t) =>
          t.type(
            t.label('What or who are you reporting, and what is wrong?'),
            "There's a comment on Order new textbooks, on the Weekend School board, that isn't appropriate.",
          ),
      },
      {
        say: 'Then tap Send. Your report goes to the admins by email, with your name, so they can get back to you.',
        do: async (t) => {
          await t.tap(t.btn('Send'));
          await t.waitFor(t.text(/^Sent\./, false));
        },
      },
      {
        say: "They'll usually reply within a day, and nobody but the admins ever sees a report.",
        do: (t) => t.highlight(t.text(/^Sent\./, false)),
      },
    ],
  },
  // ------------------------------------------------------------ board owners
  {
    id: 'new-board',
    as: 'sara',
    start: '',
    steps: [
      {
        say: "Organizers and admins can create boards. If that's you, you'll see New board at the top of your boards.",
        do: (t) => t.highlight(t.btn('New board')),
      },
      {
        say: 'Tap it, and give your board a name.',
        do: async (t) => {
          await t.tap(t.btn('New board'));
          await t.type(t.placeholder('Board name'), 'Summer Camp');
        },
      },
      {
        say: 'Then tap Create.',
        do: async (t) => {
          await t.tap(t.btn('Create'));
          await t.waitFor(t.btn('+ Add card'));
        },
      },
      {
        say: 'Every new board starts with three columns: To Do, In Progress, and Done. You can rename them, or add more, in the board settings.',
        do: (t) => t.wait(600),
      },
      {
        say: "And because you made it, you own it. You decide who's on the board, and who else gets to help run it.",
        do: (t) => t.highlight(t.btn('Board settings')),
      },
    ],
  },
  {
    id: 'board-settings',
    as: 'sara',
    start: (w) => w.board('weekend-school'),
    steps: [
      {
        say: 'If you own a board, you can change how it works. Tap the gear to open its settings.',
        do: async (t) => {
          await t.tap(t.btn('Board settings'));
          await t.waitFor(t.btn('Save name'));
        },
      },
      {
        say: 'You can rename the board here. Type the new name, and tap Save name.',
        do: async (t) => {
          await t.replace(t.placeholder('Board name'), 'Weekend School 2026');
          await t.tap(t.btn('Save name'));
        },
      },
      {
        say: 'Under Columns, tap the pencil next to a column to rename it.',
        do: async (t) => {
          await t.tap(t.btn('Rename column To Do'));
          await t.replace(t.label('Rename To Do'), 'Up next');
          await t.tap(t.btn('Save column name'));
        },
      },
      {
        say: 'To add a column, type its name at the bottom, and tap the plus.',
        do: async (t) => {
          await t.type(t.placeholder('New column name'), 'Waiting on parents');
          await t.tap(t.btn('Add column'));
        },
      },
      {
        say: 'And to change the order, drag a column up or down by its handle.',
        do: (t) => t.highlight(t.label('Drag to reorder')),
      },
      {
        say: "Right at the bottom there's the board's history. Everything you just did is already there, with your name on it.",
        do: async (t) => {
          await t.scrollTo(t.text('History'));
          await t.highlight(t.text(/added the column “Waiting on parents”/, false));
        },
      },
      {
        say: "People who don't own the board see this screen too, with the members and the history, so they know who to ask, and who changed what.",
        do: (t) => t.wait(400),
      },
      {
        say: "A column can only be deleted once it's empty, so no cards go missing. You'll find delete on the board itself, right by the column's name.",
        do: async (t) => {
          await t.tap(t.btn('Back'));
          await t.highlight(t.btn(/^Delete column /));
        },
      },
    ],
  },
  {
    id: 'board-people',
    as: 'sara',
    start: (w) => w.board('weekend-school'),
    steps: [
      {
        say: "Only the people on a board can see it. To add someone, open the board's settings.",
        do: async (t) => {
          await t.tap(t.btn('Board settings'));
          await t.scrollTo(t.btn(/^Add someone/));
        },
      },
      {
        say: "Tap the add person icon next to Members, and pick who you'd like.",
        do: async (t) => {
          await t.tap(t.btn(/^Add someone/));
          await t.tap(t.btn('Add Faisal to this board'));
          // The picker closes by itself once nobody is left to add.
          await t.tapIfShown(t.btn('Done'));
        },
      },
      {
        say: 'Each person has an Owner switch. Turn it on, and they can run the board just like you can.',
        do: (t) => t.tap(t.switch('Owner of this board: Omar')),
      },
      {
        say: "You'll always be asked to confirm, so an accidental tap never changes anything.",
        do: (t) => t.wait(1200),
      },
      {
        say: "To take someone off the board, tap the remove icon on their row. Any of the board's cards assigned to them are unassigned, and you're told how many first.",
        do: async (t) => {
          await t.tap(t.btn('Remove Faisal from this board'));
          await t.wait(1800);
          await t.tap(t.btn('Cancel'));
        },
      },
      {
        say: 'The person who created the board is marked, and only an admin can take their ownership away.',
        do: (t) => t.highlight(t.text('created this board', false)),
      },
    ],
  },
  {
    id: 'board-archive',
    as: 'sara',
    start: (w) => w.board('fundraising'),
    steps: [
      {
        say: "Anyone on a board can archive a card, which keeps it safe. But only the board's owners can delete one for good.",
        do: (t) => t.wait(600),
      },
      {
        say: "To delete a card, open the board's archived cards.",
        do: async (t) => {
          await t.tap(t.btn('Archived cards'));
          await t.waitFor(t.text('Raffle prizes from last year'));
        },
      },
      {
        say: "Then tap the red bin. You'll be asked to make sure, because a deleted card, with its comments and files, can't be brought back.",
        do: async (t) => {
          await t.tap(t.btn('Delete Raffle prizes from last year permanently'));
          await t.waitGone(t.text('Raffle prizes from last year'));
        },
      },
      {
        say: "If you're not sure, just archive it instead. That's always the safer choice.",
        do: (t) => t.tap(t.btn('Back')),
      },
      {
        say: "Boards themselves are never deleted. When one's finished, open its settings, scroll down, and tap Archive board.",
        do: async (t) => {
          await t.tap(t.btn('Board settings'));
          await t.scrollTo(t.btn('Archive board'));
          await t.tap(t.btn('Archive board'));
          await t.waitFor(t.text('Boards'));
        },
      },
      {
        say: "It disappears from everyone's list, and its cards drop out of My Work and Search. Nothing is lost, though.",
        do: (t) => t.wait(600),
      },
      {
        say: 'It waits under Archived, at the bottom of your boards. Open it from there, and use Restore board in its settings to bring it all back.',
        do: async (t) => {
          await t.scrollTo(t.btn(/^Archived \(\d+\)$/));
          await t.tap(t.btn(/^Archived \(\d+\)$/));
          await t.highlight(t.text('Fundraising 2026'));
        },
      },
    ],
  },
  // ------------------------------------------------------------------ admins
  {
    id: 'people',
    as: 'faisal',
    start: '',
    steps: [
      {
        say: "When someone signs in for the first time, they wait for an admin to let them in, and you'll get an alert about it.",
        do: async (t) => {
          await t.tap(t.btn(/^Alerts/));
          await t.highlight(t.btn(/Amina is waiting for approval/));
        },
      },
      {
        say: 'Tap the alert to go straight to People. You can also get there from More.',
        do: async (t) => {
          await t.tap(t.btn(/Amina is waiting for approval/));
          await t.waitFor(t.btn('Approve'));
        },
      },
      {
        say: "This is everyone who's signed in. Amina's waiting to be let in.",
        do: (t) => t.scrollTo(t.btn('Approve')),
      },
      {
        say: "If it's someone who shouldn't have access, Reject keeps them out.",
        do: (t) => t.highlight(t.btn('Reject')),
      },
      {
        say: 'Otherwise, tap Approve, and confirm.',
        do: (t) => t.tap(t.btn('Approve')),
      },
      {
        say: "And that's it. Her screen opens up straight away, wherever she is, and she can start using her boards.",
        do: (t) => t.wait(600),
      },
    ],
  },
  {
    id: 'roles',
    as: 'faisal',
    start: '',
    steps: [
      {
        say: "To manage everyone's access, open More, and then People.",
        do: async (t) => {
          await t.tap(t.btn('More'));
          await t.tap(t.btn('People'));
          await t.scrollTo(t.switch('Account access for Omar'));
        },
      },
      {
        say: "Everyone has a role. Members see the boards they've been added to, and that's it.",
        do: (t) => t.highlight(t.person('Omar').getByRole('button', { name: 'Set role member', exact: true })),
      },
      {
        say: 'Organizers can do the same, and they can also create new boards.',
        do: (t) => t.highlight(t.person('Omar').getByRole('button', { name: 'Set role organizer', exact: true })),
      },
      {
        say: 'And admins can do everything, including managing people, labels, and Stats.',
        do: (t) => t.highlight(t.person('Omar').getByRole('button', { name: 'Set role admin', exact: true })),
      },
      {
        say: "To change someone's role, tap the one you want, and confirm. Let's make Omar an organizer.",
        do: (t) => t.tap(t.person('Omar').getByRole('button', { name: 'Set role organizer', exact: true })),
      },
      {
        say: "The Active switch turns an account off. They're signed out straight away and can't get back in, but their cards are kept just as they were.",
        do: (t) => t.highlight(t.switch('Account access for Omar')),
      },
      {
        say: "Turn it back on any time, because nothing's ever deleted. And you can't change your own access, which stops an admin from locking themselves out.",
        do: (t) => t.wait(600),
      },
    ],
  },
  {
    id: 'labels',
    as: 'faisal',
    start: (w) => w.card('fundraising', 'date'),
    steps: [
      {
        say: 'Labels are shared by every board, so a label means the same thing wherever you see it.',
        do: (t) => t.scrollTo(t.btn('New label')),
      },
      {
        say: 'Anyone can add a new one from a card, using the plus next to the labels.',
        do: (t) => t.highlight(t.btn('New label')),
      },
      {
        say: "Renaming, recolouring and deleting labels is for admins, since it changes cards on every board. You'll find them in any board's settings.",
        do: async (t) => {
          await t.tap(t.link(/^Open board Fundraising 2026/));
          await t.tap(t.btn('Board settings'));
          await t.scrollTo(t.btn('Rename label Events'));
        },
      },
      {
        say: 'Tap the pencil to rename one.',
        do: async (t) => {
          await t.tap(t.btn('Rename label Events'));
          await t.replace(t.label('New name for label Events'), 'Event day');
          await t.tap(t.btn('Save name for label Events'));
        },
      },
      {
        say: 'The palette button changes its colour.',
        do: (t) => t.tap(t.btn('Change colour of Volunteers')),
      },
      {
        say: "And the bin deletes it. You're told how many cards have the label first, because it comes off all of them.",
        do: async (t) => {
          await t.tap(t.btn('Delete label Supplies'));
          await t.wait(1800);
          await t.tap(t.btn('Cancel'));
        },
      },
    ],
  },
  {
    id: 'stats',
    as: 'faisal',
    start: '',
    steps: [
      {
        say: "Stats shows how the boards are being used. It's for admins, and you'll find it under More.",
        do: async (t) => {
          await t.tap(t.btn('More'));
          await t.tap(t.btn('Stats'));
          await t.waitFor(t.id('stats-plot'));
        },
      },
      {
        say: 'Each bar is one day. Tap a bar to see its exact number.',
        do: (t) => t.tap(t.page.getByLabel(/^[1-9]\d* cards created, /).filter({ visible: true }).last()),
      },
      {
        say: 'Underneath, it shows which boards that work happened on. Tap a board to go straight to it.',
        do: (t) => t.scrollTo(t.text(/^By board/, false)),
      },
      {
        say: 'You can switch between days, weeks and months with these buttons.',
        do: async (t) => {
          await t.scroll(-1000);
          await t.tap(t.radio('Weekly'));
          await t.wait(800);
          await t.tap(t.radio('Monthly'));
        },
      },
      {
        say: 'And choose what to count: cards created, comments, files, or how many people were active.',
        do: (t) => t.tap(t.btn(/^Active people filter/)),
      },
      {
        say: 'Look at all your boards together, or pick just one.',
        do: async (t) => {
          await t.tap(t.btn(/^Board filter/));
          await t.tap(t.btn('Fundraising 2026'));
        },
      },
      {
        say: "It's there to show how the boards are being used, not to judge anyone's work.",
        do: (t) => t.wait(600),
      },
    ],
  },
];
