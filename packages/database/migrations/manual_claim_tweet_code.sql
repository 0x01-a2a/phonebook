-- Add claim_tweet_code for tweet verification
ALTER TABLE agents ADD COLUMN IF NOT EXISTS claim_tweet_code VARCHAR(12);
