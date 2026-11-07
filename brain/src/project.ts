// The project's public name lives here and only here: Truck Assistant (picked
// Nov 2026; logo and icon in docs/brand/truck-assistant/). Renaming is a
// one-line change to PROJECT_NAME. Pure (no Node APIs) so the UI imports it too.

export const PROJECT_NAME = 'Truck Assistant';

export const PROJECT = {
  name: PROJECT_NAME,
  /** Short form for tight spots (the cockpit's top strip). */
  shortName: PROJECT_NAME.toUpperCase(),
  notice: `${PROJECT_NAME} is an independent DIY project. Not affiliated with, endorsed by or sponsored by Slate Auto.`,
  license: 'MIT',
  copyright: 'Copyright (c) 2026 Jeff Raben',
} as const;
