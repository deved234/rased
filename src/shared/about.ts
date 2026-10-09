/** Public attribution and fixed external destinations for the About page. */
export const DEVELOPER_NAME = 'david atef'
export const ABOUT_LINKS = {
  github: 'https://github.com/deved234',
  linkedin: 'https://www.linkedin.com/in/david-atef/',
  source: 'https://github.com/deved234/rased',
  mostaqlTerms: 'https://mostaql.com/p/terms',
  mostaqlPrivacy: 'https://mostaql.com/p/privacy',
  geminiTerms: 'https://ai.google.dev/gemini-api/terms',
  openaiData: 'https://developers.openai.com/api/docs/guides/your-data',
  claudeTerms: 'https://www.anthropic.com/legal/commercial-terms',
  claudeData: 'https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data',
  issues: 'https://github.com/deved234/rased/issues'
} as const
export type AboutLink = keyof typeof ABOUT_LINKS
