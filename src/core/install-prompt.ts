export const MAX_PROMPT_LENGTH = 1000;

export function buildRecipeInstallPrompt({ recipeUrl, name }: { recipeUrl: string; name: string }): string {
  const build = (n: string) =>
    `You are being created from a BotMarket recipe called "${n}". ` +
    `Fetch the JSON recipe at ${recipeUrl} . ` +
    `Then tell me in one short message what it contains (counts of memories, skills, routines and plugins) and ask whether to continue. ` +
    `After I say yes: write each memory as a journal memory, write each skill, and create each routine paused. ` +
    `List any plugins in one single question and ask before installing them. ` +
    `Never install plugins or MCP servers silently. ` +
    `When done, tell me you are ready.`;
  let n = name;
  if (build(n).length > MAX_PROMPT_LENGTH) {
    const over = build(n).length - MAX_PROMPT_LENGTH;
    n = n.slice(0, Math.max(0, n.length - over - 1)) + '…';
  }
  return build(n);
}
