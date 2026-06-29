import type { Env } from "./types";
import { sendMessage } from "./discord";
import { DropboxStore } from "./stores/dropbox";

const CMD = "garoo";
const HELP = ["garoo login <service> <code?>", "garoo help"].join("\n");

/** Whether a message is a garoo command (e.g. "garoo login dropbox"). */
export function isCommand(content: string): boolean {
  return content === CMD || content.startsWith(CMD + " ");
}

/**
 * Handle a garoo command, replying in the Discord channel. Mirrors
 * garoo/command.go: `login <service> <code?>` (Dropbox OAuth) and `help`.
 */
export async function processCommand(
  content: string,
  env: Env,
  replyToMessageId: string
): Promise<void> {
  const reply = (msg: string) =>
    sendMessage(
      env.DISCORD_BOT_TOKEN!,
      env.DISCORD_CHANNEL_ID!,
      msg,
      replyToMessageId
    ).catch((e) => console.error("command reply failed:", e));

  const args = content.split(/\s+/).slice(1); // drop the leading "garoo"
  const sub = args[0];

  if (!sub || sub === "help") {
    await reply(HELP);
    return;
  }

  if (sub === "login") {
    const service = args[1];
    const code = args[2];

    if (service === "dropbox") {
      const dropbox = DropboxStore.fromEnv(env);
      if (!dropbox) {
        await reply("dropbox is not configured (need client id/secret/base dir)");
        return;
      }
      if (!code) {
        await reply(
          `Authorize, then send \`garoo login dropbox <code>\`:\n${dropbox.authUrl()}`
        );
        return;
      }
      try {
        await dropbox.exchangeCode(code);
        await reply("DONE");
      } catch (e) {
        await reply(`login failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }

    await reply("not found");
    return;
  }

  await reply(`unknown command: ${sub}`);
}
