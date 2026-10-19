// FAQ Help Centre content. Every answer reflects behaviour present in the current app code.

export type FaqCategoryId = 'start' | 'rehearsal' | 'learn' | 'selftape' | 'voice' | 'support';

export interface FaqItem {
  id: string;
  category: FaqCategoryId;
  q: string;
  a: string;
}

export const FAQ_CATEGORIES: { id: FaqCategoryId; label: string; icon: string }[] = [
  { id: 'start', label: 'Getting Started', icon: 'rocket-outline' },
  { id: 'rehearsal', label: 'Rehearsal & AI Voices', icon: 'people-outline' },
  { id: 'learn', label: 'Learning Lines', icon: 'school-outline' },
  { id: 'selftape', label: 'Teleprompter & Self-Tape', icon: 'videocam-outline' },
  { id: 'voice', label: 'Voice Studio & Premium', icon: 'mic-outline' },
  { id: 'support', label: 'Troubleshooting & Support', icon: 'construct-outline' },
];

export const FAQ_ITEMS: FaqItem[] = [
  // Getting Started
  {
    id: 'add-script', category: 'start', q: 'How do I add a script?',
    a: '1. On Home, tap New Script (or the + button in My Scripts).\n2. Paste your script into Script Text and add an optional title, or tap Tap to Upload to choose a file (PDF, TXT, DOC or DOCX).\n3. Save the script. Tap Use Sample if you want to try the app with an example first.',
  },
  {
    id: 'format', category: 'start', q: 'How should my script be formatted?',
    a: 'For the best character detection:\n• Put character names in ALL CAPS on their own line.\n• Put the dialogue on the lines that follow.\n• Put stage directions in (parentheses) or [brackets].',
  },
  {
    id: 'library', category: 'start', q: 'Where do I find my saved scripts?',
    a: 'Open My Scripts from Home. Tap a script to open it, or tap its trash icon to delete it (you will be asked to confirm).',
  },
  {
    id: 'character', category: 'start', q: 'How do I choose which character I play?',
    a: 'Open a script and pick your role under Select Your Character. The AI reads all of the other characters.',
  },

  // Rehearsal & AI Voices
  {
    id: 'start-rehearsal', category: 'rehearsal', q: 'How do I start a rehearsal?',
    a: '1. Open a script and select your character.\n2. Choose a Training Mode, an AI Reader Style (Neutral, Emotional or Intense) and the Pacing.\n3. Tap Rehearse, then Start Scene.',
  },
  {
    id: 'modes', category: 'rehearsal', q: 'What do the training modes do?',
    a: '• Full Read: practise the complete scene with prompts.\n• Cue Only: recall your lines from memory.\n• Recall: test your memory with hidden lines.',
  },
  {
    id: 'rehearsal-controls', category: 'rehearsal', q: 'Which controls can I use during a rehearsal?',
    a: '• Show Hint reveals a hidden line.\n• Done moves on when you have finished your line.\n• Auto starts listening for your line and Stop ends listening. You can also turn on "Auto-advance when line detected".\n• Restart and Skip control the scene.\nAt the end, tap Run Again or View Stats to see line completion, hints used and weak lines.',
  },
  {
    id: 'voices', category: 'rehearsal', q: 'How do I change the AI voices?',
    a: 'Open a script and use Voice Settings to choose an AI Voice and the Voice Speed. Voices marked with a lock need ScriptM8 Pro. AI voices are generated online, so you need an internet connection.',
  },

  // Learning Lines
  {
    id: 'learn-start', category: 'learn', q: 'How do I learn my lines?',
    a: '1. Open a script and tap Learn Lines.\n2. Choose your Character and a Practice mode: Full script, This scene, or Weak lines only.\n3. Start the session.',
  },
  {
    id: 'learn-rate', category: 'learn', q: 'How does a learning session work?',
    a: 'Try to say each line, then tap Reveal line and rate yourself Missed, Almost or Got it. Lines you struggle with are marked Weak, so you can practise them later with Weak lines only. When the session ends, tap View summary.',
  },
  {
    id: 'learn-resume', category: 'learn', q: 'Can I continue an unfinished session?',
    a: 'Yes. If a session is still in progress, the Learn screen shows a resume banner. Tap Start again if you would rather begin from the top.',
  },
  {
    id: 'practice-partner', category: 'learn', q: 'What are Practice Mode and Scene Partner?',
    a: 'Both can be opened from a script\'s screen as extra ways to practise. Practice Mode starts with the first scene.',
  },

  // Teleprompter & Self-Tape
  {
    id: 'tp-open', category: 'selftape', q: 'How do I open the teleprompter?',
    a: 'Go to Self Tape and tap Teleprompter Mode. It opens with the first script in your list and shows the script over the front camera.',
  },
  {
    id: 'tp-controls', category: 'selftape', q: 'Which teleprompter controls are available?',
    a: '• Play/pause starts or stops the scroll, and the reset button returns to the top.\n• Speeds 1–5 change how fast the script scrolls.\n• The gear opens Teleprompter Settings: Font Size, Background Opacity, Position (top, middle or bottom), Highlight My Lines and Framing Guides.\n• The record button starts and stops recording. Afterwards you can choose Share Now, Save or Retake.',
  },
  {
    id: 'selftape-record', category: 'selftape', q: 'How do I record a self-tape?',
    a: '1. In Self Tape, choose a script under Select a Script (Pro feature), or use Quick Paste Script to paste text.\n2. Pick a scene and your character. Set the font size, Hide Other Characters and the 3-Second Countdown.\n3. Tap Start Recording.\nWhile recording you can switch on the script scroll (with play/pause, speed and A-/A+), flip the camera, and use Shot Coach. Long-press Shot Coach for the grid, eye-line and headroom guides.',
  },
  {
    id: 'selftape-after', category: 'selftape', q: 'What can I do with a take?',
    a: 'When a take finishes, choose Share Now, Save, Retake or Review Recording. On the Review screen you can Save to Library, Generate Casting Link, save to the Gallery, Share, Retake or delete the take. Saved takes are listed in My Takes and stored on your device.',
  },
  {
    id: 'casting-link', category: 'selftape', q: 'How do I create a casting link?',
    a: 'On the Review screen, tap Generate Casting Link. Enter your actor name; role, project and a password are optional. Then tap Generate Link and use Copy Link or Share.',
  },

  // Voice Studio & Premium
  {
    id: 'vs-what', category: 'voice', q: 'What is Voice Studio?',
    a: 'Voice Studio records and manages your own voice. It does not generate AI voices. Tap the microphone to record, use Pause/Resume, and tap Stop to save the take. You can choose a script to read on screen, filter it by character, and step through it with Prev and Next.',
  },
  {
    id: 'vs-takes', category: 'voice', q: 'How do I edit or manage voice takes?',
    a: 'On the Takes tab, each take has Play, Rename, Edit, Share and Delete. Edit offers Trim, Normalize, De-Silence or All. Processing creates a new version, and the original take is kept.',
  },
  {
    id: 'vs-reel', category: 'voice', q: 'How do I build a demo reel?',
    a: 'Record at least two takes. Then open the Reels tab, tap Build Demo Reel, select your takes and reorder them with the arrows, and tap Build Reel. Saved reels can be played, shared or deleted.',
  },
  {
    id: 'pro', category: 'voice', q: 'What does ScriptM8 Pro include, and what does it cost?',
    a: 'Open the Premium screen to see the current list of Pro features and the live prices for your region. Prices come directly from Google Play on Android.',
  },
  {
    id: 'trial', category: 'voice', q: 'Is there a free trial?',
    a: 'On Android, the Premium screen shows Start 7-Day Free Trial only when Google Play offers a trial for your account and you have not used one before. If the button is not shown, you can still subscribe directly.',
  },
  {
    id: 'restore', category: 'voice', q: 'How do I restore a purchase?',
    a: 'Open the Premium screen and tap Restore (top right) or Restore Purchases. The app will tell you whether a purchase was restored or none was found.',
  },

  // Troubleshooting & Support
  {
    id: 'ts-premium', category: 'support', q: 'I paid, but Premium is not showing.',
    a: '1. Open the Premium screen and tap Restore Purchases.\n2. If you see "Premium is Still Syncing", wait a minute, check your internet connection, and tap Retry.\n3. If it still does not work, send a Bug Report from this screen.',
  },
  {
    id: 'ts-permissions', category: 'support', q: 'The camera or microphone is not working.',
    a: 'Self Tape, Teleprompter and Voice Studio need camera and/or microphone access. Tap Grant Permission when asked. If access was denied earlier, the self-tape recorder offers Open Settings so you can allow it in your device settings.',
  },
  {
    id: 'ts-import', category: 'support', q: 'My script did not import correctly.',
    a: 'Check the formatting tips (character names in ALL CAPS on their own line). If text cannot be read from a file, paste the script into Script Text instead. If saving fails, the app shows "Couldn\'t save this script" so you can try again.',
  },
  {
    id: 'ts-voices', category: 'support', q: 'The AI voices are not playing.',
    a: 'AI voices are generated online, so check your internet connection and try again. Make sure your device volume is turned up.',
  },
  {
    id: 'ts-report', category: 'support', q: 'How do I report a problem?',
    a: 'Open the Bug Report tab, describe what happened and the steps to reproduce it, and tap Report Issue. You receive a Reference ID when the report is received. If sending fails, your text is kept and you can tap Copy Report to send it manually. Copy Diagnostic Report and Copy Last Error copy extra details. Clear Diagnostic Log does not delete your scripts.',
  },
  {
    id: 'ts-build', category: 'support', q: 'Where can I find my app version?',
    a: 'Open the Build Info tab. It shows the installed app version and, on Android, the version code. Tap Copy Diagnostics to copy those details for support.',
  },
];
