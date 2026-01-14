import puppeteer, { Browser } from "@cloudflare/puppeteer";

interface Env {
  BROWSER: Fetcher;
}

interface Post {
  id: string;
  url: string;
  text: string;
  time: string;
  photos: string[];
  author: Profile;
}

interface Profile {
  id: string;
  name: string;
  screenname: string;
  url: string;
  avatar: string;
  description: string;
}

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

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.6 Safari/537.36";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Debug: take screenshot
    if (url.pathname === "/screenshot") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        return Response.json({ error: "url parameter is required" }, { status: 400 });
      }

      try {
        const screenshot = await takeScreenshot(env.BROWSER, targetUrl);
        return new Response(screenshot as unknown as ArrayBuffer, {
          headers: { "Content-Type": "image/png" },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    }

    if (url.pathname === "/scrape") {
      const postUrl = url.searchParams.get("url");
      if (!postUrl) {
        return Response.json({ error: "url parameter is required" }, { status: 400 });
      }

      try {
        const post = await scrapePost(env.BROWSER, postUrl);
        return Response.json(post);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    }

    if (url.pathname === "/profile") {
      const screenname = url.searchParams.get("screenname");
      if (!screenname) {
        return Response.json({ error: "screenname parameter is required" }, { status: 400 });
      }

      try {
        const profile = await scrapeProfile(env.BROWSER, screenname);
        return Response.json(profile);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    }

    return Response.json({
      message: "Garoo Workers POC - X Scraper",
      endpoints: {
        "/scrape?url=<post_url>": "Scrape a post from X",
        "/profile?screenname=<screenname>": "Scrape a profile from X",
        "/screenshot?url=<url>": "Take a screenshot of any URL (debug)",
      },
    });
  },
};

function parsePostUrl(postUrl: string): { id: string; screenname: string } | null {
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

async function scrapePost(browserBinding: Fetcher, postUrl: string): Promise<Post> {
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
    // 404 page has a centered search button with no tweet content
    const result = await Promise.race([
      page.waitForSelector("time", { timeout: 15000 }).then(() => "found" as const),
      page.waitForSelector('main [role="button"]:only-child', { timeout: 15000 }).then(() => "notfound" as const),
    ]);

    if (result === "notfound") {
      throw new Error("Post not found (404)");
    }

    // Get text from tweet content
    const text = await page.$eval('[data-testid="tweetText"]', (el) =>
      el.textContent || ""
    ).catch(() => "");

    // Get time from first tweet's time element
    const time = await page.$eval('[data-testid="tweet"] time', (el) =>
      el.getAttribute("datetime") || ""
    ).catch(() => "");

    // Get photos
    const photos = await page.$$eval('[data-testid="tweetPhoto"] img', (imgs) =>
      imgs
        .map((img) => img.getAttribute("src") || "")
        .filter((src) => src && !src.includes("ext_tw_video_thumb"))
        .map((src) => {
          // Convert to large format
          try {
            const url = new URL(src);
            url.searchParams.set("name", "large");
            return url.toString();
          } catch {
            return src;
          }
        })
    ).catch(() => [] as string[]);

    // Get profile
    const profile = await scrapeProfileFromPage(browser, screenname);

    return {
      id,
      url: targetUrl,
      text,
      time,
      photos,
      author: profile,
    };
  } finally {
    await browser.close();
  }
}

async function scrapeProfile(browserBinding: Fetcher, screenname: string): Promise<Profile> {
  const browser = await puppeteer.launch(browserBinding);

  try {
    return await scrapeProfileFromPage(browser, screenname);
  } finally {
    await browser.close();
  }
}

async function scrapeProfileFromPage(browser: Browser, screenname: string): Promise<Profile> {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  const profileUrl = `https://x.com/${screenname}`;
  console.log(`Navigating to profile: ${profileUrl}`);

  await page.goto(profileUrl, { waitUntil: "networkidle0", timeout: 30000 });

  // Wait for profile to load
  await page.waitForSelector('[data-testid="UserName"]', { timeout: 15000 });

  // Get profile JSON from the schema element
  const profileJson = await page.$eval('[data-testid="UserProfileSchema-test"]', (el) =>
    el.textContent || "{}"
  ).catch(() => "{}");

  let parsed: ProfileJSON = {};
  try {
    parsed = JSON.parse(profileJson);
  } catch {
    console.error("Failed to parse profile JSON");
  }

  const mainEntity = parsed.mainEntity || {};

  return {
    id: mainEntity.identifier || "",
    name: mainEntity.givenName || mainEntity.additionalName || "",
    screenname,
    url: profileUrl,
    avatar: mainEntity.image?.contentUrl || "",
    description: mainEntity.description || "",
  };
}

async function takeScreenshot(browserBinding: Fetcher, targetUrl: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch(browserBinding);

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(targetUrl, { waitUntil: "networkidle0", timeout: 30000 });

    // Wait a bit for any dynamic content
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const screenshot = await page.screenshot({ fullPage: false });
    return screenshot;
  } finally {
    await browser.close();
  }
}
