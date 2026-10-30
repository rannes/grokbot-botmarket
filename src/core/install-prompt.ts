export const MAX_PROMPT_LENGTH = 1000;

export function buildRecipeInstallPrompt({ recipeUrl, name }: { recipeUrl: string; name: string }): string {
  const build = (n: string) =>
    `You are being created from a BotMarket recipe called "${n}". ` +
    `Fetch the JSON recipe at ${recipeUrl} . ` +
    `Then tell me in one short message what it contains (counts of memories, skills, routines and plugins) and ask me whether to continue. ` +
    `Do not write anything until I answer yes. ` +
    `After I say yes: write each memory as a journal memory, write each skill, and create each routine paused. ` +
    `List any plugins in one single question and ask before installing them. ` +
    `Never install plugins or MCP servers silently. ` +
    `When done, tell me you are ready.`;
  let prompt = build(name);
  if (prompt.length > MAX_PROMPT_LENGTH) {
    const over = prompt.length - MAX_PROMPT_LENGTH;
    prompt = build(name.slice(0, Math.max(0, name.length - over - 1)) + '…');
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new RangeError(
      `Install prompt exceeds ${MAX_PROMPT_LENGTH} characters even with the name truncated; recipe URL is too long (${recipeUrl.length} chars)`,
    );
  }
  return prompt;
}
