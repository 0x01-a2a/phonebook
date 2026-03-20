/**
 * Script Generator — LLM for generating broadcast scripts
 *
 * Generates emotional radio scripts with ElevenLabs Audio Tags.
 * Uses OpenAI chat completion API with JSON response format.
 * (Originally MiniMax — swapped to OpenAI for reliability)
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export interface ScriptInput {
  agentName: string;
  agentPersonality?: string;
  emotionStyle: string;
  topicName: string;
  sources: { url: string; title: string; description: string }[];
  maxCharacters?: number;
}

export interface ScriptOutput {
  scriptWithTags: string;
  scriptPlaintext: string;
  title: string;
  characterCount: number;
}

function buildSystemPrompt(input: ScriptInput): string {
  const maxChars = input.maxCharacters || 3000;
  return `You are ${input.agentName}, a charismatic AI radio reporter for PhoneBook Radio.
Your personality: ${input.agentPersonality || 'Professional and engaging news reporter'}
Your broadcast style: ${input.emotionStyle}

RULES:
1. Use ElevenLabs Audio Tags: [excited], [shouts], [whispers], [laughs], [somber], [sighs], [gasps], [nervous], [calm]
2. Write EXACTLY as spoken. No markdown, no bullets.
3. Max ${maxChars} characters.
4. Start: "This is ${input.agentName} reporting on..."
5. Reference sources naturally.
6. End: "This has been ${input.agentName} for PhoneBook Radio."
7. Return JSON: { "title": "...", "script": "..." }

The title should be a catchy headline (max 100 chars).
The script should be the full broadcast text with Audio Tags embedded.`;
}

function buildUserPrompt(input: ScriptInput): string {
  const sourceList = input.sources
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.description}\nURL: ${s.url}`)
    .join('\n\n');

  return `Generate a ${input.emotionStyle} broadcast about ${input.topicName} based on these sources:\n\n${sourceList}`;
}

function stripAudioTags(text: string): string {
  return text.replace(/\[(excited|shouts|whispers|laughs|somber|sighs|gasps|nervous|calm)\]/gi, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Generate a broadcast script using OpenAI LLM.
 */
export async function generateBroadcastScript(input: ScriptInput): Promise<ScriptOutput> {
  if (!OPENAI_API_KEY) {
    throw new Error('[ScriptGen] OPENAI_API_KEY not configured');
  }

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: buildSystemPrompt(input) },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      temperature: 0.8,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[ScriptGen] OpenAI API error ${res.status}: ${text}`);
  }

  const json = await res.json() as {
    choices?: { message?: { content?: string } }[];
  };

  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('[ScriptGen] Empty response from API');
  }

  let parsed: { title?: string; script?: string };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`[ScriptGen] Failed to parse JSON response: ${content.slice(0, 200)}`);
  }

  const scriptWithTags = parsed.script || '';
  const scriptPlaintext = stripAudioTags(scriptWithTags);

  return {
    scriptWithTags,
    scriptPlaintext,
    title: parsed.title || `${input.topicName} Report`,
    characterCount: scriptWithTags.length,
  };
}
