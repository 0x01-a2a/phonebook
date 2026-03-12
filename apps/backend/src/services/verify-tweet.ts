/**
 * Verify that a tweet contains the claim verification code.
 * Uses Twitter API v2 (Bearer token) to fetch tweet by ID.
 * When TWITTER_BEARER_TOKEN is not set, falls back to trust-based (dev).
 */

const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;

/** Extract tweet ID from X/Twitter URL */
export function extractTweetIdFromUrl(url: string): string | null {
  const trimmed = url.trim();
  // https://twitter.com/user/status/1234567890 or https://x.com/user/status/1234567890
  const match = trimmed.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  return match ? match[1] : null;
}

/** Fetch tweet text via Twitter API v2 */
async function fetchTweetText(tweetId: string): Promise<string | null> {
  if (!TWITTER_BEARER_TOKEN) return null;

  try {
    const res = await fetch(`https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=text`, {
      headers: {
        Authorization: `Bearer ${TWITTER_BEARER_TOKEN}`,
      },
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { text?: string } };
    return data.data?.text ?? null;
  } catch {
    return null;
  }
}

/**
 * Verify that the tweet at the given URL contains the expected code.
 * Returns true if verified, false otherwise.
 * When TWITTER_BEARER_TOKEN is not set, returns true (trust-based, for dev).
 */
export async function verifyTweetContainsCode(tweetUrl: string, expectedCode: string): Promise<boolean> {
  if (!expectedCode || expectedCode.length < 4) return false;

  const tweetId = extractTweetIdFromUrl(tweetUrl);
  if (!tweetId) return false;

  const text = await fetchTweetText(tweetId);
  if (text === null) {
    // API not configured or failed — trust-based (dev)
    return !TWITTER_BEARER_TOKEN;
  }

  return text.includes(expectedCode);
}
