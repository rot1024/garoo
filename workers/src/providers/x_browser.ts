// ARCHIVED: Browser Rendering (puppeteer) based X provider.
// Superseded by the twitterapi.io provider in ./x.ts, but kept here because it
// may be revived later. Not wired into index.ts. Uses the BROWSER binding.
import puppeteer, { Browser } from "@cloudflare/puppeteer";
import type { Post, Author, Media } from "../types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.6 Safari/537.36";

interface ProfileJSON {
  mainEntity?: {
    identifier?: string;
    givenName?: string;
    additionalName?: string;
    description?: string;
    image?: {
      contentUrl?: string;
    };
  };
}

/**
 * Parse a Twitter/X post URL
 */
export function parsePostUrl(
  postUrl: string
): { id: string; screenname: string } | null {
  try {
    const url = new URL(postUrl);
    if (url.host !== "twitter.com" && url.host !== "x.com") {
      return null;
    }

    const parts = url.pathname.split("/");
    if (parts.length < 4 || parts[2] !== "status") {
      return null;
    }

    return { id: parts[3], screenname: parts[1] };
  } catch {
    return null;
  }
}

/**
 * Scrape a post from Twitter/X
 */
export async function getPost(
  browserBinding: Fetcher,
  postUrl: string
): Promise<Post> {
  const parsed = parsePostUrl(postUrl);
  if (!parsed) {
    throw new Error("Invalid X post URL");
  }

  const { id, screenname } = parsed;
  const browser = await puppeteer.launch(browserBinding);

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    const targetUrl = `https://x.com/${screenname}/status/${id}`;
    console.log(`Navigating to: ${targetUrl}`);

    await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 30000 });

    // Check for 404: race between tweet loading and 404 page
    const result = await Promise.race([
      page
        .waitForSelector("time", { timeout: 15000 })
        .then(() => "found" as const),
      page
        .waitForSelector('main [role="button"]:only-child', { timeout: 15000 })
        .then(() => "notfound" as const),
    ]);

    if (result === "notfound") {
      throw new Error("Post not found (404)");
    }

    // Get text from tweet content
    const content = await page
      .$eval('[data-testid="tweetText"]', (el) => el.textContent || "")
      .catch(() => "");

    // Get time from first tweet's time element
    const timestamp = await page
      .$eval('[data-testid="tweet"] time', (el) =>
        el.getAttribute("datetime") || ""
      )
      .catch(() => "");

    // Get photos
    const photoUrls = await page
      .$$eval('[data-testid="tweetPhoto"] img', (imgs) =>
        imgs
          .map((img) => img.getAttribute("src") || "")
          .filter((src) => src && !src.includes("ext_tw_video_thumb"))
          .map((src) => {
            try {
              const url = new URL(src);
              url.searchParams.set("name", "large");
              return url.toString();
            } catch {
              return src;
            }
          })
      )
      .catch(() => [] as string[]);

    // Get profile
    const author = await scrapeProfileFromPage(browser, screenname);

    // Convert to standard Post format
    const media: Media[] = photoUrls.map((url) => ({
      type: "photo" as const,
      url,
    }));

    return {
      id,
      provider: "twitter",
      url: targetUrl,
      timestamp,
      content,
      author,
      media: media.length > 0 ? media : undefined,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Scrape profile information
 */
async function scrapeProfileFromPage(
  browser: Browser,
  screenname: string
): Promise<Author> {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  const profileUrl = `https://x.com/${screenname}`;
  console.log(`Navigating to profile: ${profileUrl}`);

  await page.goto(profileUrl, { waitUntil: "networkidle0", timeout: 30000 });

  // Wait for profile to load
  await page.waitForSelector('[data-testid="UserName"]', { timeout: 15000 });

  // Get profile JSON from the schema element
  const profileJson = await page
    .$eval('[data-testid="UserProfileSchema-test"]', (el) =>
      el.textContent || "{}"
    )
    .catch(() => "{}");

  let parsed: ProfileJSON = {};
  try {
    parsed = JSON.parse(profileJson);
  } catch {
    console.error("Failed to parse profile JSON");
  }

  const mainEntity = parsed.mainEntity || {};

  return {
    id: mainEntity.identifier || "",
    screen_name: screenname,
    name: mainEntity.givenName || mainEntity.additionalName || "",
    description: mainEntity.description || "",
    avatar: mainEntity.image?.contentUrl || "",
    provider: "twitter",
  };
}
