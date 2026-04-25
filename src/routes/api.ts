import { Router } from 'express';
import { GithubUserAnalysis } from '../models/UserAnalysis';
import { enqueueGithubAnalysis } from '../queue/githubAnalysisQueue';
import { runGithubAnalysisJob } from '../services/githubAnalysisService';

const router = Router();
const RETRY_MAX_ATTEMPTS = Number(process.env.ANALYSIS_RETRY_MAX_ATTEMPTS || 3);
const RETRY_WINDOW_MS = Number(process.env.ANALYSIS_RETRY_WINDOW_MS || 60 * 60 * 1000);
const ANALYSIS_NOT_FOUND_ERROR =
  'Analysis not found. Please register/login with GitHub to start analysis.';
const AUTH_REQUIRED_ERROR = 'Please register/login with GitHub first.';
const OAUTH_START_PATH = '/auth/github';

function oauthRequiredResponse(res: any) {
  return res.status(401).json({
    error: AUTH_REQUIRED_ERROR,
    message: 'Trying to analyze without GitHub OAuth. Please login with GitHub to continue.',
    oauthStartUrl: OAUTH_START_PATH,
  });
}

router.get('/me', async (req, res) => {
  if (!req.session.githubId) {
    return oauthRequiredResponse(res);
  }

  try {
    const user = await GithubUserAnalysis.findOne({ githubId: req.session.githubId });
    if (!user) {
      return res.status(404).json({ error: ANALYSIS_NOT_FOUND_ERROR });
    }

    return res.json({
      username: user.username,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/v1/analysis/me', async (req, res) => {
  if (!req.session.githubId) {
    return oauthRequiredResponse(res);
  }

  try {
    const user = await GithubUserAnalysis.findOne({ githubId: req.session.githubId });

    if (!user) {
      return res.status(404).json({ error: ANALYSIS_NOT_FOUND_ERROR });
    }

    // Return the sanitized user object without the accessToken
    const sanitizedUser = {
      username: user.username,
      status: user.status,
      retry: {
        retryCount: user.retryCount || 0,
        retryWindowStart: user.retryWindowStart ?? null,
        lastRetryAt: user.lastRetryAt ?? null,
        maxAttempts: RETRY_MAX_ATTEMPTS,
        windowMs: RETRY_WINDOW_MS,
      },
      repositories: user.repositories,
      evaluation: user.evaluation,
      tokenConsumption: user.evaluation?.tokenUsage ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      crawlSnapshots: (user.crawlSnapshots || []).map((s) => ({
        url: s.url,
        success: s.success,
        fetchedAt: s.fetchedAt,
        statusCode: s.statusCode,
        error: s.error,
        markdownPreviewChars: s.markdownPreview?.length ?? 0,
        markdownPreview: s.markdownPreview
          ? `${s.markdownPreview.slice(0, 2000)}${s.markdownPreview.length > 2000 ? '…' : ''}`
          : undefined,
      })),
      responseSchema: 'profile-analysis.v2',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    res.json(sanitizedUser);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/v1/analysis', async (req, res) => {
  if (!req.session.githubId) {
    return oauthRequiredResponse(res);
  }

  try {
    const user = await GithubUserAnalysis.findOne({ githubId: req.session.githubId });
    if (!user) {
      return res.status(404).json({ error: ANALYSIS_NOT_FOUND_ERROR });
    }

    if (user.status === 'processing') {
      return res.status(409).json({ error: 'Analysis already in progress' });
    }

    const now = Date.now();
    const windowStartMs = user.retryWindowStart ? new Date(user.retryWindowStart).getTime() : 0;
    const windowExpired = !windowStartMs || now - windowStartMs > RETRY_WINDOW_MS;

    if (windowExpired) {
      user.retryCount = 0;
      user.retryWindowStart = new Date(now);
    }

    if ((user.retryCount || 0) >= RETRY_MAX_ATTEMPTS) {
      const retryAfterMs = RETRY_WINDOW_MS - (now - new Date(user.retryWindowStart as Date).getTime());
      return res.status(429).json({
        error: 'Retry limit reached',
        retryAfterMs: Math.max(0, retryAfterMs),
        maxAttempts: RETRY_MAX_ATTEMPTS,
        windowMs: RETRY_WINDOW_MS,
      });
    }

    user.retryCount = (user.retryCount || 0) + 1;
    user.lastRetryAt = new Date(now);
    user.status = 'pending';
    await user.save();

    try {
      await enqueueGithubAnalysis(user.githubId);
    } catch (queueError) {
      console.error('Retry enqueue failed (Redis unavailable). Inline fallback.', queueError);
      void runGithubAnalysisJob(user.githubId);
    }

    return res.json({
      message:
        'Analysis is happening. It will take some time; once done, the updated result will be reflected back.',
      retry: {
        retryCount: user.retryCount,
        retryWindowStart: user.retryWindowStart,
        lastRetryAt: user.lastRetryAt,
        maxAttempts: RETRY_MAX_ATTEMPTS,
        windowMs: RETRY_WINDOW_MS,
      },
    });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
