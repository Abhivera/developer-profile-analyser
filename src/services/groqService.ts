import axios from 'axios';
import type { IProfileEvaluation, ITokenUsage } from '../models/UserAnalysis';

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

export type GroqEvaluation = {
  totalStars: number;
  totalForks: number;
  totalRepositories: number;
  primaryLanguage: string;
  languageDiversity: number;
  score: number;
  judgmentMessage: string;
  highlights?: string[];
  risksOrGaps?: string[];
};

export type GroqEvaluationResult = {
  evaluation: GroqEvaluation;
  tokenUsage: ITokenUsage;
  model: string;
};

type GroqArgs = {
  username: string;
  repoSummary: string;
  crawlContext: string;
};

function buildSystemPrompt(): string {
  return [
    'You evaluate a software developer based on GitHub repository metadata and optional crawled personal/site content.',
    'If provided, incorporate external profile signals such as LinkedIn, LeetCode, HackerRank, TopCoder, Codeforces, AtCoder, CodeChef, HackerEarth, Codility, and InterviewBit into highlights and risksOrGaps.',
    'Respond with a single JSON object only (no markdown fences). Fields:',
    'totalStars (number), totalForks (number), totalRepositories (number),',
    'primaryLanguage (string), languageDiversity (integer count of distinct languages),',
    'score (0-100 integer), judgmentMessage (2-4 sentences),',
    'highlights (array of short strings, optional), risksOrGaps (array of short strings, optional).',
    'Use the provided numeric facts for totals and language usage; do not invent repository counts.',
  ].join(' ');
}

export async function evaluateProfileWithGroq(args: GroqArgs): Promise<GroqEvaluationResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  const userContent = [
    `GitHub username: ${args.username}`,
    '',
    'Repository / stats summary:',
    args.repoSummary,
    '',
    'Crawled pages (markdown excerpts, may include LinkedIn/LeetCode/HackerRank, and may be empty):',
    args.crawlContext || '(none)',
  ].join('\n');

  try {
    const { data } = await axios.post(
      GROQ_CHAT_URL,
      {
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: userContent },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 120_000,
      }
    );

    const raw = data?.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(text) as IProfileEvaluation;
    if (
      typeof parsed.score !== 'number' ||
      typeof parsed.judgmentMessage !== 'string' ||
      typeof parsed.primaryLanguage !== 'string'
    ) {
      return null;
    }
    const promptTokens = Number(data?.usage?.prompt_tokens) || 0;
    const completionTokens = Number(data?.usage?.completion_tokens) || 0;
    const totalTokens =
      Number(data?.usage?.total_tokens) || promptTokens + completionTokens;

    return {
      evaluation: parsed,
      tokenUsage: { promptTokens, completionTokens, totalTokens },
      model: typeof data?.model === 'string' ? data.model : model,
    };
  } catch (err) {
    console.error('Groq evaluation failed:', err);
    return null;
  }
}
